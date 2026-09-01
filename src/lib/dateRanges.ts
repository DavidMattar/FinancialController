import { formatLocalDate } from "./dateOnly";

// Os intervalos abaixo montam `Date` com o construtor local (`new Date(ano,
// mes, dia)`), então a volta para "YYYY-MM-DD" tem de ser local também:
// `toISOString()` converte para UTC antes de cortar e pode devolver o dia
// anterior (ver `formatLocalDate` em dateOnly.ts).
const toISODate = formatLocalDate;

/** Intervalo de datas usado para filtrar transações, no formato "YYYY-MM-DD". */
export interface DateRange {
  from: string;
  to: string;
}

/** Retorna o intervalo do primeiro ao último dia do mês atual. */
export function currentMonthRange(): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  // Dia 0 do mês seguinte é o truque do JS para "último dia do mês atual".
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(from), to: toISODate(to) };
}

/** Retorna o intervalo do primeiro ao último dia do mês anterior ao atual. */
export function lastMonthRange(): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: toISODate(from), to: toISODate(to) };
}

/**
 * Retorna o intervalo dos últimos `n` meses, incluindo o mês atual completo
 * (ex: `lastNMonthsRange(3)` chamado em agosto retorna de 1º de junho até o
 * último dia de agosto).
 */
export function lastNMonthsRange(n: number): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(from), to: toISODate(to) };
}

/** Retorna o intervalo do primeiro dia de janeiro ao último dia de dezembro do ano atual. */
export function currentYearRange(): DateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), 0, 1);
  const to = new Date(now.getFullYear(), 11, 31);
  return { from: toISODate(from), to: toISODate(to) };
}

/**
 * Retorna o intervalo do primeiro ao último dia de um mês específico.
 *
 * Existe para os seletores de mês/ano do título de `/receitas`: a página
 * mostra um mês por vez, mas não necessariamente o corrente.
 *
 * @param year - Ano com quatro dígitos (ex: 2026).
 * @param month - Mês de 1 (janeiro) a 12 (dezembro), não o índice 0-11 do `Date`.
 */
export function monthRange(year: number, month: number): DateRange {
  const from = new Date(year, month - 1, 1);
  // Dia 0 do mês seguinte é o truque do JS para "último dia deste mês".
  const to = new Date(year, month, 0);
  return { from: toISODate(from), to: toISODate(to) };
}
