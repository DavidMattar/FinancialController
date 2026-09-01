/**
 * Formato dos registros de log — o vocabulário compartilhado entre quem gera o
 * evento (navegador) e quem grava o arquivo (rota `/api/logs`).
 *
 * Decisões que valem saber:
 * - **Horário local, não UTC.** O arquivo do dia é escolhido pela data LOCAL
 *   (é o dia que o usuário reconhece), então o horário de cada linha também é
 *   local — misturar os dois faria uma linha de 23h aparecer no arquivo do dia
 *   seguinte. O deslocamento vai escrito na linha (`-03:00`) para o arquivo não
 *   ficar ambíguo se um dia for lido em outra máquina.
 * - **Uma linha por evento, com campos separados por ` | `.** Precisa ser
 *   legível por gente (é um arquivo que o dono do app vai abrir no Notepad) e
 *   ainda dar para `grep`/`Select-String`. JSON por linha seria melhor para
 *   máquina e pior para o uso real deste projeto.
 * - **Nada de valor sensível.** A descrição diz o que mudou, não o corpo
 *   inteiro da requisição.
 */

/** Gravidade do evento. `error` também vai para o log de erros paralelo. */
export type LogLevel = "info" | "error";

/** Um evento a registrar. */
export interface LogEvent {
  /** Instante do evento (ISO completo; o formatador converte para local). */
  at: string;
  /** Slug da aba de onde o evento veio — define o arquivo (ver `appTabs.ts`). */
  tab: string;
  level: LogLevel;
  /**
   * Verbo curto do que aconteceu: `navegou`, `gravou`, `apagou`, `erro`...
   * Fica numa coluna própria para dar para filtrar por tipo de movimentação.
   */
  action: string;
  /** Descrição legível ("criou transação", "apagou compra de investimento"). */
  detail: string;
  /** Detalhe técnico opcional (status HTTP, corpo do erro, stack). */
  technical?: string;
}

/** Largura fixa das colunas, só para o arquivo ficar alinhado ao ser lido. */
const LEVEL_WIDTH = 5;
const ACTION_WIDTH = 9;

/** Dois dígitos com zero à esquerda. */
function dd(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Deslocamento de fuso do instante, no formato `-03:00`.
 *
 * `getTimezoneOffset()` devolve minutos ATRÁS de UTC com o sinal invertido
 * (Brasília = +180), por isso o sinal é calculado ao contrário do que parece.
 */
function offsetOf(date: Date): string {
  const minutos = -date.getTimezoneOffset();
  const sinal = minutos < 0 ? "-" : "+";
  const abs = Math.abs(minutos);
  return `${sinal}${dd(Math.floor(abs / 60))}:${dd(abs % 60)}`;
}

/** Data local no formato `AAAA-MM-DD` — é o nome da pasta do dia. */
export function localDayOf(date: Date): string {
  return `${date.getFullYear()}-${dd(date.getMonth() + 1)}-${dd(date.getDate())}`;
}

/** Horário local `HH:MM:SS.mmm-03:00`. */
function localTimeOf(date: Date): string {
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${dd(date.getHours())}:${dd(date.getMinutes())}:${dd(date.getSeconds())}.${ms}${offsetOf(date)}`;
}

/** Uma linha de arquivo de log (sem o `\n`, que quem grava acrescenta). */
export function formatLogLine(event: LogEvent): string {
  const at = new Date(event.at);
  const campos = [
    `${localDayOf(at)} ${localTimeOf(at)}`,
    (event.level === "error" ? "ERRO" : "INFO").padEnd(LEVEL_WIDTH),
    event.action.padEnd(ACTION_WIDTH),
    event.tab,
    event.detail,
  ];
  if (event.technical) campos.push(event.technical);
  return campos.join(" | ");
}

/**
 * Linha do log de ERROS (o log paralelo). Igual à do log da aba, mas com a aba
 * no começo em vez de no meio: esse arquivo junta todas as abas, então "de onde
 * veio" é a primeira coisa que se quer ler.
 */
export function formatErrorLogLine(event: LogEvent): string {
  const at = new Date(event.at);
  const campos = [
    `${localDayOf(at)} ${localTimeOf(at)}`,
    `[${event.tab}]`,
    event.action,
    event.detail,
  ];
  if (event.technical) campos.push(event.technical);
  return campos.join(" | ");
}

// ---------------------------------------------------------------------------
// Descrição legível de uma requisição
// ---------------------------------------------------------------------------

/**
 * Nome em português do recurso de cada rota da API, para o log dizer "criou
 * transação" em vez de "POST /api/transactions".
 *
 * A ordem importa: a primeira que casar ganha, então as rotas mais específicas
 * vêm antes das mais gerais (`/api/transactions/[id]/items` antes de
 * `/api/transactions`).
 */
const RESOURCE_PATTERNS: [RegExp, string][] = [
  [/^\/api\/transactions\/[^/]+\/items(\/|$)/, "sub-item de transação"],
  [/^\/api\/transactions\/[^/]+\/move-to-family$/, "transação movida para a família"],
  [/^\/api\/transactions\/export/, "exportação de transações"],
  [/^\/api\/transactions\/metrics/, "métricas de transações"],
  [/^\/api\/transactions(\/|$)/, "transação"],
  [/^\/api\/family-transactions(\/|$)/, "transação da família"],
  [/^\/api\/categories(\/|$)/, "categoria"],
  [/^\/api\/credit-cards(\/|$)/, "cartão de crédito"],
  [/^\/api\/invoices\/parse$/, "leitura de fatura"],
  [/^\/api\/invoices\/confirm$/, "importação de fatura"],
  [/^\/api\/receipts\/parse$/, "leitura de nota fiscal"],
  [/^\/api\/receipts\/confirm$/, "importação de nota fiscal"],
  [/^\/api\/investments\/[^/]+\/purchases(\/|$)/, "compra de investimento"],
  [/^\/api\/investments\/prices$/, "cotação de investimentos"],
  [/^\/api\/investments(\/|$)/, "investimento"],
  [/^\/api\/views(\/|$)/, "view salva"],
  [/^\/api\/budget\/summary$/, "orçamento do período"],
  [/^\/api\/seasonal-rentals\/preview$/, "prévia de aluguel"],
  [/^\/api\/seasonal-rentals(\/|$)/, "aluguel de temporada"],
  [/^\/api\/rental-settlements\/preview$/, "prévia de repasse"],
  [/^\/api\/rental-settlements(\/|$)/, "repasse de aluguel"],
  [/^\/api\/backup\/export$/, "backup do banco"],
  [/^\/api\/backup\/restore/, "restauração de backup"],
  [/^\/api\/logs$/, "log"],
];

/** Verbo em português de cada método HTTP de escrita. */
const METHOD_VERB: Record<string, string> = {
  POST: "criou",
  PUT: "atualizou",
  PATCH: "atualizou",
  DELETE: "apagou",
  GET: "consultou",
};

/**
 * Só o caminho de uma URL que pode ser absoluta ou relativa.
 *
 * A base só serve para o construtor aceitar caminho relativo; ela é descartada.
 * O `catch` não é decorativo: uma URL absoluta com host inválido
 * (`http://[`) faz o construtor lançar mesmo havendo base. Nesse caso devolve
 * o texto original — o log nunca pode ser a causa de uma exceção.
 */
export function pathOf(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url;
  }
}

/** Nome do recurso de um caminho, ou o próprio caminho quando não há um nome melhor. */
export function resourceOf(path: string): string {
  for (const [padrao, nome] of RESOURCE_PATTERNS) {
    if (padrao.test(path)) return nome;
  }
  return path;
}

/**
 * Descrição legível de uma requisição, para a coluna de detalhe do log:
 * `POST /api/transactions` → "criou transação".
 */
export function describeRequest(method: string, url: string): string {
  const upper = method.toUpperCase();
  const verbo = METHOD_VERB[upper] ?? upper.toLowerCase();
  return `${verbo} ${resourceOf(pathOf(url))}`;
}

/** `true` para os métodos que MUDAM dado — os que sempre viram linha de log. */
export function isWriteMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE";
}
