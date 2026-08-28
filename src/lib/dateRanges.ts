/** Formata uma Date como "YYYY-MM-DD" (formato usado nos filtros de período do app). */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

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
