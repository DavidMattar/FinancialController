import { parseLocalDate } from "./dateOnly";
import { monthRange } from "./dateRanges";

/** Formata um número como moeda brasileira (ex: 1234.5 -> "R$ 1.234,50"). */
export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Formata uma data para exibição no padrão brasileiro (DD/MM/AAAA).
 *
 * @param date - Pode ser um objeto `Date`, uma string "YYYY-MM-DD" (data sem
 *   horário) ou uma string ISO completa (com horário/timezone).
 */
export function formatDate(date: Date | string): string {
  // Bare "YYYY-MM-DD" strings must be parsed as local dates, not UTC (see
  // src/lib/dateOnly.ts) — full ISO timestamps (with time+zone) are safe as-is.
  const d = typeof date === "string" ? (date.length === 10 ? parseLocalDate(date) : new Date(date)) : date;
  return new Intl.DateTimeFormat("pt-BR").format(d);
}

/**
 * Converte um mês de referência no formato "YYYY-MM" para um texto legível
 * em português (ex: "2026-08" -> "agosto de 2026").
 */
export function monthLabel(referenceMonth: string): string {
  const [year, month] = referenceMonth.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(d);
}

/**
 * Descreve um período ("de"/"até" em "YYYY-MM-DD") em texto legível.
 *
 * Quando o período começa no dia 1º e termina no último dia de um mês, ele é
 * descrito por nome de mês ("agosto de 2026", "junho de 2026 a agosto de
 * 2026") — é o caso dos atalhos do `DateRangePicker` e do seletor de mês de
 * `/receitas`. Um período que corta o mês no meio cai nas datas
 * ("05/08/2026 a 20/08/2026"): dizer "agosto de 2026" ali seria mentira, e o
 * banner de orçamento existe justamente para dizer de que período é o número.
 */
export function periodLabel(from: string, to: string): string {
  const inicio = parseLocalDate(from);
  const fim = parseLocalDate(to);
  const mesInteiro = monthRange(fim.getFullYear(), fim.getMonth() + 1);
  const mesesInteiros = inicio.getDate() === 1 && to === mesInteiro.to;

  if (!mesesInteiros) return `${formatDate(inicio)} a ${formatDate(fim)}`;

  const mesInicio = from.slice(0, 7);
  const mesFim = to.slice(0, 7);
  if (mesInicio === mesFim) return monthLabel(mesInicio);
  return `${monthLabel(mesInicio)} a ${monthLabel(mesFim)}`;
}
