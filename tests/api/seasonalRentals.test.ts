import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/seasonal-rentals/route";
import { POST as PREVIEW } from "@/app/api/seasonal-rentals/preview/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { jsonRequest, readJson } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Registro como o Prisma devolve. 08/06→11/06/2026 = R$ 420 de tabela. */
function registro(over: Record<string, unknown> = {}) {
  return {
    id: "rent-1",
    platform: "AIRBNB",
    checkIn: new Date(2026, 5, 8),
    checkOut: new Date(2026, 5, 11),
    netAmountReceived: "1000.00",
    cleaningFee: "180.00",
    notes: null,
    nightRateOverrides: null,
    createdAt: new Date(2026, 5, 1),
    davidSettlementId: null,
    familiaSettlementId: null,
    transactionId: null,
    expenses: [],
    ...over,
  };
}

const corpoValido = {
  platform: "AIRBNB",
  checkIn: "2026-06-08",
  checkOut: "2026-06-11",
  netAmountReceived: 1000,
  cleaningFee: 180,
};

describe("GET /api/seasonal-rentals", () => {
  it("lista os aluguéis com os valores calculados, do mais recente primeiro", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([registro()]);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body[0].computed.tableValue).toBe(420);
    expect(body[0].computed.totalDavid).toBe(250);
    expect(prisma.seasonalRental.findMany).toHaveBeenCalledWith({
      include: { expenses: true },
      orderBy: { checkIn: "desc" },
    });
  });

  it("expõe as flags de repasse já fechado", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([
      registro({ davidSettlementId: "set-1" }),
    ]);

    const { body } = await readJson(await GET());

    expect(body[0].isDavidSettled).toBe(true);
    expect(body[0].isFamiliaSettled).toBe(false);
  });
});

describe("POST /api/seasonal-rentals", () => {
  beforeEach(() => {
    prisma.seasonalRental.create.mockResolvedValue(registro());
    prisma.seasonalRental.update.mockResolvedValue(registro({ transactionId: "tx-receita" }));
    prisma.category.findFirst.mockResolvedValue({ id: "cat-aluguel" });
    prisma.transaction.create.mockResolvedValue({ id: "tx-receita" });
  });

  it("cria o aluguel e responde 201 com os valores calculados", async () => {
    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido)),
    );

    expect(status).toBe(201);
    expect(body.computed.totalDavid).toBe(250);
  });

  it("converte as datas sem cair no bug de fuso", async () => {
    await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido));

    const data = prisma.seasonalRental.create.mock.calls[0][0].data;
    expect(data.checkIn).toEqual(new Date(2026, 5, 8));
    expect(data.checkOut).toEqual(new Date(2026, 5, 11));
  });

  it("cria automaticamente a transação de receita com o Total David", async () => {
    await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido));

    const data = prisma.transaction.create.mock.calls[0][0].data;
    expect(data.amount).toBe(250);
    expect(data.type).toBe("INCOME");
    expect(data.source).toBe("IMPORT");
    // Datada de um dia depois do check-out.
    expect(data.date).toEqual(new Date(2026, 5, 12));
    expect(data.description).toContain("Airbnb");
    expect(data.description).toContain("2026-06-08");
    expect(data.description).toContain("2026-06-11");
  });

  it("associa a receita à categoria 'Aluguel Rancho'", async () => {
    await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido));

    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      where: { name: "Aluguel Rancho" },
    });
    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBe("cat-aluguel");
  });

  it("cria a receita sem categoria quando 'Aluguel Rancho' não existe", async () => {
    prisma.category.findFirst.mockResolvedValue(null);

    await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido));

    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBeNull();
  });

  it("guarda a referência da transação criada no aluguel", async () => {
    await POST(jsonRequest("POST", "/api/seasonal-rentals", corpoValido));

    expect(prisma.seasonalRental.update).toHaveBeenCalledWith({
      where: { id: "rent-1" },
      data: { transactionId: "tx-receita" },
      include: { expenses: true },
    });
  });

  it("usa o rótulo Booking na descrição quando a plataforma é Booking", async () => {
    await POST(
      jsonRequest("POST", "/api/seasonal-rentals", { ...corpoValido, platform: "BOOKING" }),
    );
    expect(prisma.transaction.create.mock.calls[0][0].data.description).toContain("Booking");
  });

  it("cria os gastos extras junto e os considera no cálculo", async () => {
    await POST(
      jsonRequest("POST", "/api/seasonal-rentals", {
        ...corpoValido,
        expenses: [{ description: "Gás", amount: 100 }],
      }),
    );

    expect(prisma.seasonalRental.create.mock.calls[0][0].data.expenses).toEqual({
      create: [{ description: "Gás", amount: 100 }],
    });
    // 1000 − 100(10%) − 180 − 420 − 100 = 200 de extra → David = 100 + 100
    expect(prisma.transaction.create.mock.calls[0][0].data.amount).toBe(200);
  });

  it("salva só as diárias customizadas que pertencem ao período", async () => {
    await POST(
      jsonRequest("POST", "/api/seasonal-rentals", {
        ...corpoValido,
        nightRateOverrides: { "2026-06-09": 240, "2026-12-31": 999 },
      }),
    );

    expect(prisma.seasonalRental.create.mock.calls[0][0].data.nightRateOverrides).toEqual({
      "2026-06-09": 240,
    });
  });

  it("usa as diárias customizadas no valor da transação de receita", async () => {
    await POST(
      jsonRequest("POST", "/api/seasonal-rentals", {
        ...corpoValido,
        nightRateOverrides: { "2026-06-09": 240 },
      }),
    );
    // Tabela sobe para 520, então o extra cai 100 e o David cai 50.
    expect(prisma.transaction.create.mock.calls[0][0].data.amount).toBe(200);
  });

  it("usa limpeza zero como padrão e aceita observação nula", async () => {
    await POST(
      jsonRequest("POST", "/api/seasonal-rentals", {
        platform: "AIRBNB",
        checkIn: "2026-06-08",
        checkOut: "2026-06-11",
        netAmountReceived: 1000,
      }),
    );

    const data = prisma.seasonalRental.create.mock.calls[0][0].data;
    expect(data.cleaningFee).toBe(0);
    expect(data.notes).toBeNull();
  });

  it("aceita valor recebido zero", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/seasonal-rentals", { ...corpoValido, netAmountReceived: 0 }),
      ),
    );
    expect(status).toBe(201);
  });

  it("recusa plataforma desconhecida com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/seasonal-rentals", { ...corpoValido, platform: "VRBO" })),
    );
    expect(status).toBe(400);
    expect(prisma.seasonalRental.create).not.toHaveBeenCalled();
  });

  it("recusa valores negativos com 400", async () => {
    for (const corpo of [
      { ...corpoValido, netAmountReceived: -1 },
      { ...corpoValido, cleaningFee: -1 },
      { ...corpoValido, expenses: [{ description: "X", amount: -1 }] },
      { ...corpoValido, nightRateOverrides: { "2026-06-09": -5 } },
    ]) {
      const { status } = await readJson(
        await POST(jsonRequest("POST", "/api/seasonal-rentals", corpo)),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa gasto extra sem descrição com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/seasonal-rentals", {
          ...corpoValido,
          expenses: [{ description: "", amount: 10 }],
        }),
      ),
    );
    expect(status).toBe(400);
  });
});

describe("POST /api/seasonal-rentals/preview", () => {
  it("calcula os valores sem gravar nada", async () => {
    const { status, body } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", {
          checkIn: "2026-06-08",
          checkOut: "2026-06-11",
          netAmountReceived: 1000,
          cleaningFee: 180,
        }),
      ),
    );

    expect(status).toBe(200);
    expect(body.tableValue).toBe(420);
    expect(body.totalDavid).toBe(250);
    expect(body.netForDistribution).toBe(570);
    expect(prisma.seasonalRental.create).not.toHaveBeenCalled();
  });

  it("devolve o detalhamento noite a noite (é o que a lista editável usa)", async () => {
    const { body } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", {
          checkIn: "2026-06-08",
          checkOut: "2026-06-11",
          netAmountReceived: 1000,
        }),
      ),
    );

    expect(body.nightRates).toHaveLength(3);
    expect(body.nightRates[0]).toMatchObject({
      key: "2026-06-08",
      tableRate: 140,
      rate: 140,
      isOverridden: false,
      kind: "LOW_SEASON",
    });
  });

  it("sugere a taxa de limpeza fixa", async () => {
    const { body } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", {
          checkIn: "2026-06-08",
          checkOut: "2026-06-11",
          netAmountReceived: 1000,
        }),
      ),
    );
    expect(body.suggestedCleaningFee).toBe(180);
  });

  it("aplica as diárias customizadas e ignora as fora do período", async () => {
    const { body } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", {
          checkIn: "2026-06-08",
          checkOut: "2026-06-11",
          netAmountReceived: 1000,
          cleaningFee: 180,
          nightRateOverrides: { "2026-06-09": 240, "2030-01-01": 999 },
        }),
      ),
    );

    expect(body.tableValue).toBe(520);
    expect(body.hasCustomNightRates).toBe(true);
  });

  it("considera os extras informados", async () => {
    const { body } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", {
          checkIn: "2026-06-08",
          checkOut: "2026-06-11",
          netAmountReceived: 1000,
          cleaningFee: 180,
          extrasTotal: 100,
        }),
      ),
    );
    expect(body.extrasTotal).toBe(100);
    expect(body.totalDavid).toBe(200);
  });

  it("recusa check-out anterior ou igual ao check-in com 400", async () => {
    for (const [checkIn, checkOut] of [
      ["2026-06-11", "2026-06-08"],
      ["2026-06-08", "2026-06-08"],
    ]) {
      const { status, body } = await readJson(
        await PREVIEW(
          jsonRequest("POST", "/api/seasonal-rentals/preview", {
            checkIn,
            checkOut,
            netAmountReceived: 1000,
          }),
        ),
      );
      expect(status).toBe(400);
      expect(body.error).toContain("depois da data de entrada");
    }
  });

  it("recusa corpo inválido com 400", async () => {
    const { status } = await readJson(
      await PREVIEW(
        jsonRequest("POST", "/api/seasonal-rentals/preview", { checkIn: "2026-06-08" }),
      ),
    );
    expect(status).toBe(400);
  });
});
