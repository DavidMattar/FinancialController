import { parseLocalDate } from "./dateOnly";

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
