import { describe, expect, it } from "vitest";
import { parseReceipt } from "@/lib/receiptParsers";

const itemNfce =
  "ARROZ TIPO 1 5KG (Código: 123) Qtde total de ítens: 1.000 UN: UN Valor total R$: R$ 25,90";

describe("parseReceipt", () => {
  it("interpreta uma NFC-e reconhecida", () => {
    const r = parseReceipt(["Nota Fiscal de Consumidor Eletrônica", itemNfce]);
    expect(r).not.toBeNull();
    expect(r?.items).toHaveLength(1);
    expect(r?.computedTotal).toBe(25.9);
  });

  it("devolve null para um texto que não é NFC-e", () => {
    expect(parseReceipt(["Cupom fiscal de outro formato", "R$ 10,00"])).toBeNull();
  });

  it("devolve null para texto vazio", () => {
    expect(parseReceipt([])).toBeNull();
  });

  it("devolve null quando tem o título da NFC-e mas nenhum item legível", () => {
    expect(parseReceipt(["Nota Fiscal de Consumidor Eletrônica", "layout diferente"])).toBeNull();
  });
});
