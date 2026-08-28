import { santanderParser } from "./santander";
import type { InvoiceParser } from "./types";

/**
 * Lista de todos os leitores de fatura disponíveis. Para suportar um novo
 * banco no futuro, basta criar um novo arquivo com um `InvoiceParser` (igual
 * a `santander.ts`) e adicioná-lo aqui.
 */
export const invoiceParsers: InvoiceParser[] = [santanderParser];

/**
 * Recebe as linhas de texto de um PDF de fatura e descobre qual leitor sabe
 * interpretá-la (perguntando `matches()` a cada um, na ordem da lista).
 * Retorna `null` se nenhum leitor reconhecer o formato.
 */
export function findInvoiceParser(lines: string[]): InvoiceParser | null {
  return invoiceParsers.find((p) => p.matches(lines)) ?? null;
}

export * from "./types";
