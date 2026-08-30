import { describe, expect, it } from "vitest";
import { findInvoiceParser, invoiceParsers } from "@/lib/invoiceParsers";
import { santanderParser } from "@/lib/invoiceParsers/santander";

describe("registro de parsers de fatura", () => {
  it("hoje só existe o parser do Santander", () => {
    // Se um banco novo for adicionado, este teste falha de propósito: é o
    // lembrete de que o novo parser precisa dos seus próprios testes.
    expect(invoiceParsers).toEqual([santanderParser]);
  });

  it("todo parser registrado cumpre o contrato InvoiceParser", () => {
    for (const parser of invoiceParsers) {
      expect(typeof parser.bank).toBe("string");
      expect(typeof parser.matches).toBe("function");
      expect(typeof parser.parse).toBe("function");
    }
  });
});

describe("findInvoiceParser", () => {
  it("devolve o parser do Santander para uma fatura do Santander", () => {
    expect(findInvoiceParser(["BANCO SANTANDER (BRASIL) S.A."])).toBe(santanderParser);
  });

  it("devolve null quando nenhum parser reconhece o formato", () => {
    expect(findInvoiceParser(["BANCO DESCONHECIDO", "Fatura"])).toBeNull();
  });

  it("devolve null para lista de linhas vazia", () => {
    expect(findInvoiceParser([])).toBeNull();
  });
});
