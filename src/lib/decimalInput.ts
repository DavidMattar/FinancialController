/**
 * Normalização de valores decimais digitados pelo usuário.
 *
 * Por que existe: todo campo financeiro do app é `<input type="text">` com
 * `inputMode="decimal"` (e não `type="number"`, que não aceita o formato
 * brasileiro), então o que chega é sempre texto livre — "3,07", "3.07",
 * "1.234,56", "R$ 350.000,00". Cada tela fazia `Number(valor.replace(",", "."))`,
 * que só acerta o caso de UMA vírgula sozinha: qualquer separador de milhar
 * virava `NaN`, o corpo da requisição ia com `null` e a API respondia 400 —
 * que na tela aparecia como "não dá para salvar", sem mensagem nenhuma
 * (foi exatamente esse o bug de "não consigo cadastrar mais criptomoeda":
 * um preço digitado como "350.000,00").
 *
 * Regras de interpretação (nesta ordem):
 *  1. Só RUÍDO CONHECIDO é descartado: espaços (inclusive o não-quebrável
 *     que o `Intl` usa) e um prefixo de moeda ("R$", "BRL", "US$", "$", "€"…).
 *     Qualquer OUTRO caractere estranho **recusa** o valor, em vez de ser
 *     removido: antes tudo que não fosse dígito ou separador era jogado fora, e
 *     aí "1e3" virava 13 e "12abc" virava 12, silenciosamente. Num campo de
 *     dinheiro, recusar e avisar é melhor do que adivinhar.
 *  2. Sinal só vale na frente ("-3,07"); sinal no meio ("3-07") é recusado.
 *  3. Os DOIS separadores no mesmo número: o **último** é o decimal e o outro
 *     é separador de milhar — "1.234,56" e "1,234.56" dão o mesmo 1234.56.
 *  4. O MESMO separador repetido só pode ser separador de milhar:
 *     "1.234.567" e "1,234,567" dão 1234567.
 *  5. Um separador só, qualquer que seja ele, é o **decimal**: "3,07" e
 *     "3.07" são o mesmo 3.07.
 *
 * A regra 5 é uma decisão deliberada, e o único ponto ambíguo: "1.234"
 * (que um brasileiro pode ter digitado querendo mil duzentos e trinta e
 * quatro) é lido como 1.234. Ler três casas depois de um ponto como milhar
 * resolveria esse caso, mas quebraria uma quantidade de cripto legítima
 * ("1.500" ETH viraria 1500) — e o pedido explícito é que "3,07" e "3.07"
 * sejam o mesmo número. Quem usa separador de milhar em português digita a
 * vírgula decimal junto ("1.234,56"), que a regra 3 resolve.
 *
 * NÃO confundir com o `parseBrlNumber` dos parsers de fatura/NFC-e
 * (`src/lib/invoiceParsers/santander.ts`, `src/lib/receiptParsers/nfce.ts`):
 * aqueles leem um formato de máquina, com separador conhecido e fixo, vindo
 * de um PDF — não texto livre de formulário. São propositalmente separados.
 */
import { z } from "zod";

/** Só dígitos e separadores, com sinal opcional na frente. */
const NUMERIC_RE = /^[-+]?[\d.,]+$/;

/**
 * Prefixo de moeda aceito antes do número (já sem espaços). Limitado a
 * SÍMBOLOS e códigos conhecidos de propósito: aceitar letras em geral era
 * exatamente o que fazia "12abc" passar como 12.
 */
const CURRENCY_PREFIX_RE = /^(r\$|brl|us\$|usd|eur|\$|€|£|¥)/i;

/**
 * Separa o sinal do resto, para o prefixo de moeda poder vir DEPOIS dele
 * ("-R$ 5,50"). Evita `lookbehind` no regex, que quebra o parse do arquivo
 * inteiro em navegador antigo em vez de só falhar naquele valor.
 */
const SIGN_AND_REST_RE = /^([-+]?)(.*)$/;

/**
 * Converte um valor digitado pelo usuário em número, aceitando vírgula ou
 * ponto como separador decimal (ver as regras no topo do arquivo).
 *
 * @param raw - Texto do campo. Também aceita `number` (devolvido como está,
 *   para o mesmo helper poder ser usado num valor que já é numérico) e
 *   `null`/`undefined` (campo ausente).
 * @returns O número correspondente, ou `null` quando o campo está vazio ou
 *   não descreve um número. O chamador decide o que fazer com `null` —
 *   avisar o usuário, usar um padrão ou deixar a API recusar.
 */
export function parseDecimalInput(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;

  // 1. Fora só o ruído conhecido: espaços e um prefixo de moeda.
  const compact = raw.replace(/\s/g, "");
  const [, sign, rest] = SIGN_AND_REST_RE.exec(compact)!;
  const cleaned = sign + rest.replace(CURRENCY_PREFIX_RE, "");
  // 2. Daqui em diante só dígitos e separadores passam — qualquer outro
  //    caractere recusa o valor —, e é preciso haver algum dígito.
  if (!NUMERIC_RE.test(cleaned) || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digits = cleaned.replace(/^[-+]/, "");

  const lastComma = digits.lastIndexOf(",");
  const lastDot = digits.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // 3. Os dois separadores: o último é o decimal, o outro é milhar.
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = digits.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const parts = digits.split(lastComma >= 0 ? "," : ".");
    // 4. Repetido = milhar; 5. um só = decimal.
    normalized = parts.length > 2 ? parts.join("") : parts.join(".");
  } else {
    normalized = digits;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/**
 * Igual a `parseDecimalInput`, mas devolve `fallback` no lugar de `null`.
 * Usado nos campos opcionais em que "em branco" significa um valor conhecido
 * (ex: a taxa de limpeza de um aluguel, em que vazio é 0).
 */
export function parseDecimalInputOr(raw: string | number | null | undefined, fallback: number): number {
  return parseDecimalInput(raw) ?? fallback;
}

/**
 * Embrulha um campo numérico de schema zod para ele também aceitar string com
 * vírgula ou ponto decimal, mantendo visível a restrição de verdade:
 *
 * ```ts
 * amount: decimalField(z.number().positive())
 * ```
 *
 * As telas já mandam número (elas passam por `parseDecimalInput` antes), mas a
 * API é a fronteira do sistema: quem chamar a rota direto — outra tela, um
 * script, um `curl` — também recebe "3,07" como 3.07, em vez de um 400 que
 * depende de qual cliente formatou o corpo.
 *
 * String que não descreve número é repassada intacta para o schema interno, de
 * propósito: o erro que sai é "esperado number, recebido string" em vez de um
 * `NaN` silencioso que falharia numa mensagem bem mais confusa.
 */
export function decimalField<T extends z.ZodType>(inner: T) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    return parseDecimalInput(value) ?? value;
  }, inner);
}
