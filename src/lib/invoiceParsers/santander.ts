import type { InvoiceParser, InvoiceSection, ParsedInvoice, ParsedTransaction, TransactionType } from "./types";

/**
 * IMPORTANTE: essas expressões regulares dependem do texto do PDF ter sido
 * extraído "na ordem bruta" (linha por linha, sem tentar recriar colunas
 * lado a lado) — ver `extractPdfLines` em `src/lib/pdf.ts`. O modo "-layout"
 * do pdfjs embaralha as colunas de uma fatura com múltiplos titulares/cartões,
 * então NUNCA troque a forma como as linhas chegam até aqui sem testar de
 * novo com uma fatura real do Santander.
 */

/** Linha que identifica o titular do cartão, ex: "JOAO SILVA - 1234 XXXX XXXX 5678". */
const HOLDER_RE = /^@?\s*(.+?)\s-\s(\d{4}\s?XXXX\s?XXXX\s?\d{4})$/;
/**
 * Linha de um lançamento normal: dia/mês, descrição, parcela opcional (ex:
 * "2/10"), valor em reais e, opcionalmente, valor em dólar (compras no
 * exterior trazem as duas colunas).
 */
const TX_RE =
  /^(?:\d+\s+)?(\d{2})\/(\d{2})\s+(.+?)(?:\s+(\d{1,2})\/(\d{1,2}))?\s+(-?[\d.]+,\d{2})(?:\s+(-?[\d.]+,\d{2}))?$/;
/** Linha especial de IOF cobrado sobre compras no exterior (não segue o padrão de `TX_RE`). */
const IOF_RE = /^IOF DESPESA NO EXTERIOR\s+(-?[\d.]+,\d{2})$/i;
/** Testa se uma linha é "apenas um valor em reais" (formato brasileiro, ex: "1.234,56"). */
const BRL_LINE_RE = /^-?[\d.]+,\d{2}$/;

/** Converte um número no formato brasileiro ("1.234,56") para número JS (1234.56). */
function parseBrlNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

/**
 * Procura um rótulo exato (ex: "Total desta Fatura R$") e lê o valor em reais
 * que aparece na linha imediatamente seguinte. Usado para capturar totais
 * "oficiais" impressos pelo banco, que servem de conferência com o total
 * calculado somando os lançamentos (`computedTotal`).
 */
function findValueAfterLabel(lines: string[], label: string): number | undefined {
  const idx = lines.findIndex((l) => l.trim() === label);
  if (idx === -1) return undefined;
  const next = lines[idx + 1]?.trim();
  return next && BRL_LINE_RE.test(next) ? Math.abs(parseBrlNumber(next)) : undefined;
}

/** Identifica em qual seção da fatura estamos, a partir do texto do cabeçalho da seção. */
function sectionFromLabel(line: string): InvoiceSection | null {
  if (line === "Pagamento e Demais Créditos") return "CREDITO";
  if (line === "Despesas") return "DESPESA";
  if (line === "Parcelamentos") return "PARCELAMENTO";
  return null;
}

/** Leitor de faturas do Banco Santander (ver contrato `InvoiceParser` em `./types`). */
export const santanderParser: InvoiceParser = {
  bank: "Santander",

  /** Reconhece uma fatura do Santander por textos característicos que sempre aparecem no PDF. */
  matches(lines) {
    return lines.some((l) => l.includes("BANCO SANTANDER") || l.includes("Detalhamento da Fatura"));
  },

  /**
   * Percorre as linhas da fatura de cima para baixo, mantendo um "estado
   * atual" (qual titular/cartão e qual seção — despesa, crédito ou
   * parcelamento — estamos lendo agora) e cria um `ParsedTransaction` para
   * cada lançamento reconhecido. É um parser de máquina de estados simples,
   * não uma leitura estruturada de tabela, porque o PDF não expõe uma tabela
   * de verdade — só texto em sequência.
   */
  parse(lines, referenceMonth) {
    const [refYearStr, refMonthStr] = referenceMonth.split("-");
    const refYear = Number(refYearStr);
    const refMonth = Number(refMonthStr);

    let currentHolder = "";
    let currentLastDigits = "";
    let currentSection: InvoiceSection | null = null;
    const transactions: ParsedTransaction[] = [];

    // Procura a data de vencimento da fatura (aparece uma única vez, perto do topo).
    let dueDate: Date | undefined;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "Vencimento") {
        const next = lines[i + 1]?.trim();
        const m = next?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
          dueDate = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
          break;
        }
      }
    }

    const officialTotal = findValueAfterLabel(lines, "Total desta Fatura R$");
    const minPayment = findValueAfterLabel(lines, "Pagamento Mínimo R$");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Nova seção de titular/cartão: reseta a seção atual, pois cada
      // titular tem seu próprio bloco de "Despesas"/"Créditos"/"Parcelamentos".
      const holderMatch = line.match(HOLDER_RE);
      if (holderMatch) {
        currentHolder = holderMatch[1].trim();
        currentLastDigits = holderMatch[2].replace(/\s/g, "").slice(-4);
        currentSection = null;
        continue;
      }

      const sectionLabel = sectionFromLabel(line);
      if (sectionLabel) {
        currentSection = sectionLabel;
        continue;
      }

      // Cabeçalho de coluna da tabela — não é um lançamento, apenas ignora.
      if (line.startsWith("Compra Data Descri")) continue;
      if (line.startsWith("VALOR TOTAL")) {
        currentSection = null;
        continue;
      }
      // Fora de qualquer seção conhecida (rodapé, textos legais, etc.) — ignora a linha.
      if (!currentSection) continue;

      // IOF de compra no exterior vem em uma linha própria, associada ao
      // lançamento anterior (por isso usamos a data da última transação).
      const iofMatch = line.match(IOF_RE);
      if (iofMatch && currentSection === "DESPESA") {
        transactions.push({
          date: transactions[transactions.length - 1]?.date ?? new Date(refYear, refMonth - 1, 1),
          description: "IOF - despesa no exterior",
          amount: Math.abs(parseBrlNumber(iofMatch[1])),
          type: "EXPENSE",
          section: "DESPESA",
          cardHolder: currentHolder,
          cardLastDigits: currentLastDigits,
        });
        continue;
      }

      const m = line.match(TX_RE);
      if (!m) continue;

      const [, dd, mm, descRaw, instCur, instTot, amountStr, amountUsdStr] = m;
      const description = descRaw.trim();
      if (!description) continue;

      const amount = Math.abs(parseBrlNumber(amountStr));
      let type: TransactionType = "EXPENSE";
      if (currentSection === "CREDITO") {
        // Dentro da seção de créditos, "PAGAMENTO" é o pagamento da fatura em
        // si (não deve contar como receita); qualquer outro crédito
        // (estorno, cashback) é tratado como receita.
        type = /PAGAMENTO/i.test(description) ? "PAYMENT" : "INCOME";
      }

      // A fatura lista o mês/dia da compra sem o ano. Se o mês do lançamento
      // for maior que o mês de referência da fatura, a compra necessariamente
      // ocorreu no ano anterior (ex: fatura de referência janeiro/2026 pode
      // conter compras de dezembro/2025).
      let year = refYear;
      const month = Number(mm);
      if (month > refMonth) year -= 1;

      transactions.push({
        date: new Date(year, month - 1, Number(dd)),
        description,
        amount,
        amountUsd: amountUsdStr ? Math.abs(parseBrlNumber(amountUsdStr)) : undefined,
        type,
        section: currentSection,
        installmentCurrent: instCur ? Number(instCur) : undefined,
        installmentTotal: instTot ? Number(instTot) : undefined,
        cardHolder: currentHolder,
        cardLastDigits: currentLastDigits,
      });
    }

    // Soma todos os lançamentos para conferir com o total "oficial" impresso
    // pelo banco (créditos/pagamentos subtraem, despesas somam).
    const computedTotal = transactions.reduce((sum, t) => {
      if (t.type === "EXPENSE") return sum + t.amount;
      return sum - t.amount;
    }, 0);

    const result: ParsedInvoice = {
      bank: "Santander",
      referenceMonth,
      totalAmount: officialTotal ?? computedTotal,
      computedTotal,
      transactions,
    };
    if (dueDate) result.dueDate = dueDate;
    if (minPayment !== undefined) result.minPayment = minPayment;
    return result;
  },
};
