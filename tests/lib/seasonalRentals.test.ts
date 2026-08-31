import { describe, expect, it } from "vitest";
import {
  RENTAL_PLATFORM_LABEL,
  readNightRateOverrides,
  serializeRentalWithComputed,
} from "@/lib/seasonalRentals";

describe("RENTAL_PLATFORM_LABEL", () => {
  it("tem rótulo para as duas plataformas suportadas", () => {
    expect(RENTAL_PLATFORM_LABEL.AIRBNB).toBe("Airbnb");
    expect(RENTAL_PLATFORM_LABEL.BOOKING).toBe("Booking");
  });
});

/**
 * `nightRateOverrides` é uma coluna Json livre, então esta função é a fronteira
 * entre "qualquer coisa que estiver no banco" e o cálculo do aluguel. Qualquer
 * conteúdo fora do formato precisa virar "sem customização" em vez de quebrar
 * a página de Receitas inteira.
 */
describe("readNightRateOverrides", () => {
  it("lê um mapa válido", () => {
    expect(readNightRateOverrides({ "2026-06-08": 200, "2026-06-09": 180 })).toEqual({
      "2026-06-08": 200,
      "2026-06-09": 180,
    });
  });

  it("trata null e undefined como sem customização", () => {
    expect(readNightRateOverrides(null)).toEqual({});
    expect(readNightRateOverrides(undefined)).toEqual({});
  });

  it("trata tipos primitivos como sem customização", () => {
    expect(readNightRateOverrides("texto")).toEqual({});
    expect(readNightRateOverrides(42)).toEqual({});
    expect(readNightRateOverrides(true)).toEqual({});
  });

  it("trata array como sem customização", () => {
    expect(readNightRateOverrides([1, 2, 3])).toEqual({});
  });

  it("converte valores numéricos em string", () => {
    expect(readNightRateOverrides({ "2026-06-08": "250" })).toEqual({ "2026-06-08": 250 });
  });

  it("descarta valores negativos e não numéricos, mantendo os válidos", () => {
    expect(
      readNightRateOverrides({
        "2026-06-08": -10,
        "2026-06-09": "abc",
        "2026-06-11": 150,
      }),
    ).toEqual({ "2026-06-11": 150 });
  });

  it("um valor null vira diária zero (consequência de Number(null) === 0)", () => {
    // Comportamento atual, registrado aqui de propósito: `null` passa pelo
    // filtro porque `Number(null)` é 0, um valor de diária válido. Só chega
    // aqui um Json editado à mão (a UI nunca grava null numa noite), e o efeito
    // é uma noite de graça — não uma quebra de cálculo. Se um dia isso virar
    // problema, o lugar de arrumar é `readNightRateOverrides`.
    expect(readNightRateOverrides({ "2026-06-10": null })).toEqual({ "2026-06-10": 0 });
  });

  it("mantém zero (diária de graça é valor válido)", () => {
    expect(readNightRateOverrides({ "2026-06-08": 0 })).toEqual({ "2026-06-08": 0 });
  });

  it("descarta Infinity", () => {
    expect(readNightRateOverrides({ "2026-06-08": Number.POSITIVE_INFINITY })).toEqual({});
  });

  it("objeto vazio devolve mapa vazio", () => {
    expect(readNightRateOverrides({})).toEqual({});
  });
});

describe("serializeRentalWithComputed", () => {
  /** Registro como o Prisma devolve: Decimal (aqui simulado por string) e Date. */
  const base = {
    id: "rental-1",
    platform: "AIRBNB",
    checkIn: new Date(2026, 5, 8),
    checkOut: new Date(2026, 5, 11),
    netAmountReceived: "1000.00",
    cleaningFee: "180.00",
    notes: "uma nota",
    nightRateOverrides: null as unknown,
    createdAt: new Date(2026, 5, 1),
    davidSettlementId: null as string | null,
    familiaSettlementId: null as string | null,
    limpezaSettlementId: null as string | null,
    transactionId: "tx-1" as string | null,
    expenses: [] as { id: string; description: string; amount: unknown }[],
  };

  it("converte os Decimal do banco para número", () => {
    const r = serializeRentalWithComputed({ ...base });
    expect(r.netAmountReceived).toBe(1000);
    expect(r.cleaningFee).toBe(180);
    expect(typeof r.netAmountReceived).toBe("number");
  });

  it("inclui os valores calculados", () => {
    const r = serializeRentalWithComputed({ ...base });
    expect(r.computed.nights).toBe(3);
    expect(r.computed.tableValue).toBe(420);
    expect(r.computed.totalDavid).toBe(250);
    expect(r.computed.netForDistribution).toBe(570);
  });

  it("soma os gastos extras e converte os valores deles", () => {
    const r = serializeRentalWithComputed({
      ...base,
      expenses: [
        { id: "e1", description: "Gás", amount: "60.00" },
        { id: "e2", description: "Faxina extra", amount: "40.00" },
      ],
    });
    expect(r.expenses.map((e) => e.amount)).toEqual([60, 40]);
    expect(r.computed.extrasTotal).toBe(100);
    expect(r.computed.extraTableValue).toBe(200);
  });

  it("aplica as diárias customizadas do registro", () => {
    const r = serializeRentalWithComputed({
      ...base,
      nightRateOverrides: { "2026-06-09": 240 },
    });
    expect(r.nightRateOverrides).toEqual({ "2026-06-09": 240 });
    expect(r.computed.tableValue).toBe(520);
    expect(r.computed.hasCustomNightRates).toBe(true);
  });

  it("devolve nightRateOverrides separado do computed (é o que o PUT reenvia)", () => {
    const r = serializeRentalWithComputed({ ...base, nightRateOverrides: null });
    expect(r.nightRateOverrides).toEqual({});
  });

  it("traduz os ids de repasse para flags booleanas", () => {
    const aberto = serializeRentalWithComputed({ ...base });
    expect(aberto.isDavidSettled).toBe(false);
    expect(aberto.isFamiliaSettled).toBe(false);
    expect(aberto.isLimpezaSettled).toBe(false);

    const fechadoDavid = serializeRentalWithComputed({ ...base, davidSettlementId: "set-1" });
    expect(fechadoDavid.isDavidSettled).toBe(true);
    expect(fechadoDavid.isFamiliaSettled).toBe(false);
    expect(fechadoDavid.isLimpezaSettled).toBe(false);

    const fechadoTodos = serializeRentalWithComputed({
      ...base,
      davidSettlementId: "set-1",
      familiaSettlementId: "set-2",
      limpezaSettlementId: "set-3",
    });
    expect(fechadoTodos.isDavidSettled).toBe(true);
    expect(fechadoTodos.isFamiliaSettled).toBe(true);
    expect(fechadoTodos.isLimpezaSettled).toBe(true);
  });

  it("as três trilhas são independentes: limpeza fechada não fecha as outras", () => {
    const soLimpeza = serializeRentalWithComputed({ ...base, limpezaSettlementId: "set-3" });
    expect(soLimpeza.isLimpezaSettled).toBe(true);
    expect(soLimpeza.isDavidSettled).toBe(false);
    expect(soLimpeza.isFamiliaSettled).toBe(false);
  });

  it("preserva os campos simples do registro", () => {
    const r = serializeRentalWithComputed({ ...base });
    expect(r.id).toBe("rental-1");
    expect(r.platform).toBe("AIRBNB");
    expect(r.notes).toBe("uma nota");
    expect(r.checkIn).toEqual(base.checkIn);
    expect(r.checkOut).toEqual(base.checkOut);
    expect(r.createdAt).toEqual(base.createdAt);
  });

  it("aceita notes null", () => {
    expect(serializeRentalWithComputed({ ...base, notes: null }).notes).toBeNull();
  });

  it("não expõe o transactionId (é referência interna do ledger)", () => {
    const r = serializeRentalWithComputed({ ...base });
    expect(r).not.toHaveProperty("transactionId");
  });
});
