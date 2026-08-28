import { looksLikeNfce, parseNfceReceipt } from "./nfce";
import type { ParsedReceipt } from "./types";

/**
 * Ponto de entrada único para interpretar uma nota fiscal. Hoje só existe
 * suporte a NFC-e (nota de supermercado, lida via QR Code/SEFAZ); para
 * suportar outros formatos de nota no futuro, adicione a checagem aqui,
 * seguindo o mesmo padrão de `findInvoiceParser` em `invoiceParsers/index.ts`.
 */
export function parseReceipt(lines: string[]): ParsedReceipt | null {
  if (looksLikeNfce(lines)) return parseNfceReceipt(lines);
  return null;
}

export * from "./types";
