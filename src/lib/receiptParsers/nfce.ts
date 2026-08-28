import type { ParsedReceipt, ParsedReceiptItem } from "./types";

/**
 * Linha de item da NFC-e, ex:
 * "ARROZ 5KG (Código: 123) Qtde total de ítens: 1.000 UN: UN Valor total R$: R$ 25,90".
 *
 * ATENÇÃO ao formato numérico de cada grupo capturado — a nota mistura dois
 * padrões diferentes no mesmo texto:
 * - A quantidade ("Qtde total de ítens") vem com PONTO como separador
 *   decimal (ex: "1.000" = 1 unidade, "0.500" = meio quilo) — por isso é lido
 *   direto com `Number()`, sem passar por `parseBrlNumber`.
 * - Já os valores em reais vêm no padrão brasileiro, com VÍRGULA decimal e
 *   ponto como separador de milhar (ex: "1.234,56") — por isso passam por
 *   `parseBrlNumber`. Se um dia o portal da SEFAZ mudar esse formato, ambos
 *   os grupos regex e a função de conversão usada precisam ser revistos juntos.
 */
const ITEM_RE =
  /^(.+?)\s+\(Código:\s*(\d+)\)\s+Qtde total de ítens:\s*([\d.]+)\s+UN:\s*(\S+)\s+Valor total R\$:\s*R\$\s*(-?[\d.]+,\d{2})$/;
/** Linha com o CNPJ do estabelecimento, ex: "CNPJ: 12.345.678/0001-90". */
const CNPJ_RE = /^CNPJ:\s*([\d./-]+)/;
/** Valor em reais no início de uma linha (usado para ler o total oficial da nota). */
const OFFICIAL_TOTAL_RE = /^R\$\s*(-?[\d.]+,\d{2})/;

/** Converte um valor em reais no formato brasileiro ("1.234,56") para número JS (1234.56). */
function parseBrlNumber(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

/**
 * Checagem rápida: o texto extraído parece ser uma NFC-e (nota de
 * supermercado) e contém pelo menos um item reconhecível no formato esperado?
 */
export function looksLikeNfce(lines: string[]): boolean {
  return lines.some((l) => l.includes("Nota Fiscal de Consumidor Eletrônica")) && lines.some((l) => ITEM_RE.test(l.trim()));
}

/**
 * Lê o texto (extraído da página da SEFAZ ou do PDF da nota, via QR Code)
 * e monta a lista de itens comprados mais os dados gerais da nota
 * (estabelecimento, CNPJ, data, total).
 */
export function parseNfceReceipt(lines: string[]): ParsedReceipt {
  const trimmed = lines.map((l) => l.trim());

  // O nome do estabelecimento é sempre a linha imediatamente antes do CNPJ,
  // no layout padrão da página da SEFAZ.
  const cnpjIdx = trimmed.findIndex((l) => CNPJ_RE.test(l));
  const storeName = cnpjIdx > 0 ? trimmed[cnpjIdx - 1] : "Supermercado";
  const cnpj = cnpjIdx >= 0 ? trimmed[cnpjIdx].match(CNPJ_RE)?.[1] : undefined;

  let date: Date | undefined;
  const modeloIdx = trimmed.findIndex((l) => l === "Modelo Série Número Data Emissão");
  if (modeloIdx !== -1) {
    const m = trimmed[modeloIdx + 1]?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const [, dd, mm, yyyy, hh, mi, ss] = m;
      date = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
    }
  }

  let officialTotal: number | undefined;
  const servicoIdx = trimmed.findIndex((l) => l.startsWith("Valor total do serviço"));
  if (servicoIdx !== -1) {
    const m = trimmed[servicoIdx + 1]?.match(OFFICIAL_TOTAL_RE);
    if (m) officialTotal = Math.abs(parseBrlNumber(m[1]));
  }

  const items: ParsedReceiptItem[] = [];
  for (const line of trimmed) {
    const m = line.match(ITEM_RE);
    if (!m) continue;
    const [, description, code, quantityStr, unit, amountStr] = m;
    items.push({
      description: description.trim(),
      code,
      quantity: Number(quantityStr),
      unit,
      amount: Math.abs(parseBrlNumber(amountStr)),
    });
  }

  // Soma todos os itens para conferência com o total oficial impresso na nota.
  const computedTotal = items.reduce((sum, item) => sum + item.amount, 0);

  const result: ParsedReceipt = { storeName, computedTotal, items };
  if (cnpj) result.cnpj = cnpj;
  if (date) result.date = date;
  if (officialTotal !== undefined) result.officialTotal = officialTotal;
  return result;
}
