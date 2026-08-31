import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { createSettlement, previewSettlement } from "@/lib/rentalSettlements";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";

beforeEach(resetPrismaMock);

/**
 * Aluguel como o Prisma devolve (Decimal simulado por string). O período
 * 08/06 a 11/06/2026 vale R$ 420 de tabela; com R$ 1.000 recebidos e R$ 180 de
 * limpeza, dá totalDavid = 250 e netForDistribution = 570 (ver rentalCalc).
 */
function aluguel(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "rental-1",
    platform: "AIRBNB",
    checkIn: new Date(2026, 5, 8),
    checkOut: new Date(2026, 5, 11),
    netAmountReceived: "1000.00",
    cleaningFee: "180.00",
    nightRateOverrides: null,
    expenses: [],
    ...over,
  };
}

describe("previewSettlement — tipo DAVID", () => {
  it("soma o total do David dos aluguéis pendentes", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel(),
      aluguel({ id: "rental-2" }),
    ]);

    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");

    expect(r.rentalCount).toBe(2);
    expect(r.totalAmount).toBe(500);
    expect(r.rentals.map((x) => x.id)).toEqual(["rental-1", "rental-2"]);
  });

  it("filtra por davidSettlementId nulo e pelo período de check-out", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);

    await previewSettlement("DAVID", "2026-06-01", "2026-06-30");

    const where = prisma.seasonalRental.findMany.mock.calls[0][0].where;
    expect(where.davidSettlementId).toBeNull();
    expect(where).not.toHaveProperty("familiaSettlementId");
    // Datas convertidas com dateOnly: início à meia-noite, fim no último instante.
    expect(where.checkOut.gte).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0));
    expect(where.checkOut.lte).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it("devolve zero quando não há aluguel pendente", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);
    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    expect(r).toEqual({ totalAmount: 0, rentalCount: 0, rentals: [] });
  });

  it("recalcula na hora, sem usar valor salvo (correção retroativa)", async () => {
    // Mesmo aluguel, agora com um gasto extra: o total do David muda sozinho.
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({ expenses: [{ id: "e1", description: "Gás", amount: "100.00" }] }),
    ]);
    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    expect(r.totalAmount).toBe(200);
  });

  it("usa as diárias customizadas do aluguel (senão fecharia valor diferente da tela)", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({ nightRateOverrides: { "2026-06-09": 240 } }),
    ]);
    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    // Valor de tabela vira 520, então o extra cai 100 e o David cai 50.
    expect(r.rentals[0].computed.tableValue).toBe(520);
    expect(r.totalAmount).toBe(200);
  });

  it("tolera nightRateOverrides fora do formato", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({ nightRateOverrides: "lixo" }),
    ]);
    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    expect(r.totalAmount).toBe(250);
  });

  it("devolve os aluguéis com os valores já convertidos para número", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({ expenses: [{ id: "e1", description: "Gás", amount: "60.00" }] }),
    ]);
    const r = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    expect(r.rentals[0].netAmountReceived).toBe(1000);
    expect(r.rentals[0].cleaningFee).toBe(180);
    expect(r.rentals[0].expenses[0].amount).toBe(60);
  });
});

describe("previewSettlement — tipo FAMILIA", () => {
  it("soma o líquido para distribuição e divide por 2 só no total", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel(),
      aluguel({ id: "rental-2" }),
    ]);

    const r = await previewSettlement("FAMILIA", "2026-06-01", "2026-06-30");

    // (570 + 570) / 2
    expect(r.totalAmount).toBe(570);
    // Cada aluguel individualmente continua com o valor cheio.
    expect(r.rentals[0].computed.netForDistribution).toBe(570);
  });

  it("divide por 2 mesmo com um único aluguel", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel()]);
    const r = await previewSettlement("FAMILIA", "2026-06-01", "2026-06-30");
    expect(r.totalAmount).toBe(285);
  });

  it("filtra por familiaSettlementId nulo", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);
    await previewSettlement("FAMILIA", "2026-06-01", "2026-06-30");
    const where = prisma.seasonalRental.findMany.mock.calls[0][0].where;
    expect(where.familiaSettlementId).toBeNull();
    expect(where).not.toHaveProperty("davidSettlementId");
  });

  it("as trilhas são independentes (um mesmo aluguel pode estar em todas)", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel()]);
    const david = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    const familia = await previewSettlement("FAMILIA", "2026-06-01", "2026-06-30");
    const limpeza = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    expect(david.totalAmount).toBe(250);
    expect(familia.totalAmount).toBe(285);
    expect(limpeza.totalAmount).toBe(180);
  });
});

describe("previewSettlement — tipo LIMPEZA", () => {
  it("soma o valor da limpeza dos aluguéis pendentes, sem dividir", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel(),
      aluguel({ id: "rental-2", cleaningFee: "200.00" }),
    ]);

    const r = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");

    expect(r.rentalCount).toBe(2);
    // 180 + 200, sem rateio: é o valor cheio que se paga a quem limpa.
    expect(r.totalAmount).toBe(380);
  });

  it("filtra por limpezaSettlementId nulo", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);
    await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    const where = prisma.seasonalRental.findMany.mock.calls[0][0].where;
    expect(where.limpezaSettlementId).toBeNull();
    expect(where).not.toHaveProperty("davidSettlementId");
    expect(where).not.toHaveProperty("familiaSettlementId");
  });

  it("não é afetado por gastos extras nem por diárias customizadas", async () => {
    // A limpeza é um campo informado direto no aluguel — nada no cálculo de
    // tabela/extras mexe nela (ao contrário de David e Família).
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({
        expenses: [{ id: "e1", description: "Gás", amount: "100.00" }],
        nightRateOverrides: { "2026-06-09": 240 },
      }),
    ]);
    const r = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    expect(r.totalAmount).toBe(180);
  });

  it("aluguel sem limpeza informada não soma nada", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel({ cleaningFee: "0.00" })]);
    const r = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    expect(r.rentalCount).toBe(1);
    expect(r.totalAmount).toBe(0);
  });

  it("devolve zero quando não há aluguel pendente", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);
    const r = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    expect(r).toEqual({ totalAmount: 0, rentalCount: 0, rentals: [] });
  });
});

/**
 * A soma das três trilhas de um aluguel tem que fechar exatamente o valor
 * líquido recebido — é a invariante que justifica a trilha de limpeza existir
 * como um terceiro destino, e não como um desconto embutido em outra.
 */
describe("as três trilhas somadas fecham o valor recebido", () => {
  it("David + Limpeza + Família (valor cheio) = valor líquido recebido", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel()]);

    const david = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    const limpeza = await previewSettlement("LIMPEZA", "2026-06-01", "2026-06-30");
    const familia = await previewSettlement("FAMILIA", "2026-06-01", "2026-06-30");

    // O total de FAMILIA já vem dividido por 2, então aqui usa-se o valor cheio.
    const familiaCheio = familia.rentals[0].computed.netForDistribution;
    expect(david.totalAmount + limpeza.totalAmount + familiaCheio).toBe(1000);
  });
});

describe("createSettlement", () => {
  it("cria o repasse e trava os aluguéis do tipo DAVID", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel(), aluguel({ id: "rental-2" })]);
    prisma.rentalSettlement.create.mockResolvedValue({ id: "set-1", type: "DAVID" });

    const r = await createSettlement("DAVID", "2026-06-01", "2026-06-30");

    expect(prisma.rentalSettlement.create).toHaveBeenCalledWith({
      data: {
        type: "DAVID",
        periodFrom: new Date(2026, 5, 1, 0, 0, 0, 0),
        periodTo: new Date(2026, 5, 30, 23, 59, 59, 999),
        totalAmount: 500,
        rentalCount: 2,
      },
    });
    expect(prisma.seasonalRental.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rental-1", "rental-2"] } },
      data: { davidSettlementId: "set-1" },
    });
    expect(r).toEqual({ id: "set-1", type: "DAVID" });
  });

  it("trava o campo certo no tipo LIMPEZA", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel()]);
    prisma.rentalSettlement.create.mockResolvedValue({ id: "set-9", type: "LIMPEZA" });

    await createSettlement("LIMPEZA", "2026-06-01", "2026-06-30");

    expect(prisma.rentalSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "LIMPEZA", totalAmount: 180, rentalCount: 1 }),
      }),
    );
    expect(prisma.seasonalRental.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rental-1"] } },
      data: { limpezaSettlementId: "set-9" },
    });
  });

  it("trava o campo certo no tipo FAMILIA", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguel()]);
    prisma.rentalSettlement.create.mockResolvedValue({ id: "set-2", type: "FAMILIA" });

    await createSettlement("FAMILIA", "2026-06-01", "2026-06-30");

    expect(prisma.rentalSettlement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "FAMILIA", totalAmount: 285, rentalCount: 1 }),
      }),
    );
    expect(prisma.seasonalRental.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rental-1"] } },
      data: { familiaSettlementId: "set-2" },
    });
  });

  it("devolve null e não grava nada quando não há aluguel pendente", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);

    const r = await createSettlement("DAVID", "2026-06-01", "2026-06-30");

    expect(r).toBeNull();
    expect(prisma.rentalSettlement.create).not.toHaveBeenCalled();
    expect(prisma.seasonalRental.updateMany).not.toHaveBeenCalled();
  });

  it("o valor gravado é o mesmo que o preview mostrou ao usuário", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      aluguel({ nightRateOverrides: { "2026-06-09": 240 } }),
    ]);
    prisma.rentalSettlement.create.mockResolvedValue({ id: "set-3" });

    const preview = await previewSettlement("DAVID", "2026-06-01", "2026-06-30");
    await createSettlement("DAVID", "2026-06-01", "2026-06-30");

    const gravado = prisma.rentalSettlement.create.mock.calls[0][0].data.totalAmount;
    expect(gravado).toBe(preview.totalAmount);
  });
});
