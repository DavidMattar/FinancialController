// `new Date("2026-07-06")` parses bare YYYY-MM-DD strings as UTC midnight
// (per the ES spec), which then displays as the PREVIOUS calendar day in any
// timezone behind UTC (e.g. Brazil, UTC-3). Every date-only value coming from
// a <input type="date"> or a "YYYY-MM-DD" string must go through these
// instead of the native Date constructor.

/**
 * Converte uma string "YYYY-MM-DD" (data sem horário) para um objeto `Date`
 * à meia-noite no horário LOCAL do navegador/servidor, evitando o bug de
 * fuso horário descrito acima.
 *
 * @param dateStr - Data no formato "YYYY-MM-DD" (ou uma string que comece
 *   com esses 10 caracteres — o restante, se houver, é ignorado).
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Igual a `parseLocalDate`, mas retorna o último instante do dia
 * (23:59:59.999) em vez da meia-noite. Útil para filtros de "até esta data",
 * garantindo que transações registradas em qualquer horário desse dia sejam incluídas.
 */
export function parseLocalDateEndOfDay(dateStr: string): Date {
  const d = parseLocalDate(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Retorna uma nova `Date` somando (ou subtraindo, se `days` for negativo)
 * uma quantidade de dias a partir de `date`, sem modificar o objeto original.
 */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
