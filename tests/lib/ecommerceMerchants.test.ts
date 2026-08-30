import { describe, expect, it } from "vitest";
import { isEcommerceMerchant } from "@/lib/ecommerceMerchants";

/**
 * Esta função decide se a UI oferece o checkbox "pendente de devolução" numa
 * transação. Falso positivo é barato (aparece um checkbox a mais); falso
 * negativo esconde o recurso — por isso os testes cobrem descrições reais de
 * fatura, que vêm com sufixos e prefixos colados no nome da loja.
 */
describe("isEcommerceMerchant", () => {
  it("reconhece as lojas da lista", () => {
    expect(isEcommerceMerchant("SHOPEE")).toBe(true);
    expect(isEcommerceMerchant("AMAZON")).toBe(true);
    expect(isEcommerceMerchant("TEMU")).toBe(true);
    expect(isEcommerceMerchant("EBAY")).toBe(true);
    expect(isEcommerceMerchant("ETSY")).toBe(true);
  });

  it("ignora a caixa das letras", () => {
    expect(isEcommerceMerchant("shopee")).toBe(true);
    expect(isEcommerceMerchant("Shein")).toBe(true);
    expect(isEcommerceMerchant("aliexpress")).toBe(true);
  });

  it("acha a loja no meio de uma descrição de fatura real", () => {
    expect(isEcommerceMerchant("SHOPEE 12345 SAO PAULO BR")).toBe(true);
    expect(isEcommerceMerchant("PAG*Amazonbr servicos")).toBe(true);
    expect(isEcommerceMerchant("MERCADOLIVRE*3 PARCELA 2/6")).toBe(true);
  });

  it("reconhece as variações com e sem espaço", () => {
    expect(isEcommerceMerchant("MERCADO LIVRE")).toBe(true);
    expect(isEcommerceMerchant("MERCADOLIVRE")).toBe(true);
    expect(isEcommerceMerchant("ALI EXPRESS")).toBe(true);
    expect(isEcommerceMerchant("ALIEXPRESS")).toBe(true);
    expect(isEcommerceMerchant("MAGALU")).toBe(true);
    expect(isEcommerceMerchant("MAGAZINE LUIZA")).toBe(true);
  });

  it("não reconhece comércio presencial", () => {
    expect(isEcommerceMerchant("RESTAURANTE DO ZE")).toBe(false);
    expect(isEcommerceMerchant("POSTO IPIRANGA")).toBe(false);
    expect(isEcommerceMerchant("SUPERMERCADO BH")).toBe(false);
    expect(isEcommerceMerchant("UBER TRIP")).toBe(false);
  });

  it("devolve false para descrição vazia", () => {
    expect(isEcommerceMerchant("")).toBe(false);
  });
});
