import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/rental-settlements/route";
import { GET as PREVIEW } from "@/app/api/rental-settlements/preview/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { getRequest, jsonRequest, readJson } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Aluguel pendente: 08/06→11/06/2026, R$ 1.000 recebidos, R$ 180 de limpeza. */
function aluguelPendente(over: Record<string, unknown> = {}) {
  return {
    id: "rent-1",
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

describe("GET /api/rental-settlements", () => {
  it("lista o histórico de repasses, mais recentes primeiro", async () => {
    prisma.rentalSettlement.findMany.mockResolvedValue([
      { id: "set-1", type: "DAVID", totalAmount: "500.00", rentalCount: 2 },
    ]);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(prisma.rentalSettlement.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
    // O Decimal é convertido para número na resposta.
    expect(body[0].totalAmount).toBe(500);
    expect(typeof body[0].totalAmount).toBe("number");
  });

  it("devolve lista vazia quando nenhum repasse foi gerado", async () => {
    prisma.rentalSettlement.findMany.mockResolvedValue([]);
    const { body } = await readJson(await GET());
    expect(body).toEqual([]);
  });
});

describe("POST /api/rental-settlements", () => {
  it("gera o repasse DAVID e responde 201", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguelPendente()]);
    prisma.rentalSettlement.create.mockResolvedValue({
      id: "set-1",
      type: "DAVID",
      totalAmount: "250.00",
      rentalCount: 1,
    });

    const { status, body } = await readJson(
      await POST(
        jsonRequest("POST", "/api/rental-settlements", {
          type: "DAVID",
          periodFrom: "2026-06-01",
          periodTo: "2026-06-30",
        }),
      ),
    );

    expect(status).toBe(201);
    expect(body.totalAmount).toBe(250);
    expect(prisma.seasonalRental.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["rent-1"] } },
      data: { davidSettlementId: "set-1" },
    });
  });

  it("gera o repasse FAMILIA dividindo o total por 2", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguelPendente()]);
    prisma.rentalSettlement.create.mockResolvedValue({
      id: "set-2",
      type: "FAMILIA",
      totalAmount: "285.00",
    });

    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/rental-settlements", {
          type: "FAMILIA",
          periodFrom: "2026-06-01",
          periodTo: "2026-06-30",
        }),
      ),
    );

    expect(status).toBe(201);
    expect(prisma.rentalSettlement.create.mock.calls[0][0].data.totalAmount).toBe(285);
    expect(prisma.seasonalRental.updateMany.mock.calls[0][0].data).toEqual({
      familiaSettlementId: "set-2",
    });
  });

  it("responde 422 quando não há aluguel pendente no período", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([]);

    const { status, body } = await readJson(
      await POST(
        jsonRequest("POST", "/api/rental-settlements", {
          type: "DAVID",
          periodFrom: "2026-06-01",
          periodTo: "2026-06-30",
        }),
      ),
    );

    expect(status).toBe(422);
    expect(body.error).toContain("Nenhum aluguel");
    expect(prisma.rentalSettlement.create).not.toHaveBeenCalled();
  });

  it("recusa tipo de repasse inválido com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/rental-settlements", {
          type: "OUTRO",
          periodFrom: "2026-06-01",
          periodTo: "2026-06-30",
        }),
      ),
    );
    expect(status).toBe(400);
  });

  it("recusa corpo sem período com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/rental-settlements", { type: "DAVID" })),
    );
    expect(status).toBe(400);
  });

  it("não existe rota de desfazer repasse (decisão explícita do usuário)", async () => {
    const rota = await import("@/app/api/rental-settlements/route");
    expect(rota).not.toHaveProperty("DELETE");
    expect(rota).not.toHaveProperty("PATCH");
    expect(rota).not.toHaveProperty("PUT");
  });
});

describe("GET /api/rental-settlements/preview", () => {
  it("mostra o total e os aluguéis que entrariam no repasse", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguelPendente()]);

    const { status, body } = await readJson(
      await PREVIEW(
        getRequest("/api/rental-settlements/preview", {
          from: "2026-06-01",
          to: "2026-06-30",
          type: "DAVID",
        }),
      ),
    );

    expect(status).toBe(200);
    expect(body.totalAmount).toBe(250);
    expect(body.rentalCount).toBe(1);
    expect(body.rentals[0].id).toBe("rent-1");
  });

  it("não grava nada", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguelPendente()]);

    await PREVIEW(
      getRequest("/api/rental-settlements/preview", {
        from: "2026-06-01",
        to: "2026-06-30",
        type: "DAVID",
      }),
    );

    expect(prisma.rentalSettlement.create).not.toHaveBeenCalled();
    expect(prisma.seasonalRental.updateMany).not.toHaveBeenCalled();
  });

  it("o preview usa a mesma conta do repasse real", async () => {
    prisma.seasonalRental.findMany.mockResolvedValue([aluguelPendente()]);
    prisma.rentalSettlement.create.mockResolvedValue({ id: "set-1", totalAmount: "285.00" });

    const { body: preview } = await readJson(
      await PREVIEW(
        getRequest("/api/rental-settlements/preview", {
          from: "2026-06-01",
          to: "2026-06-30",
          type: "FAMILIA",
        }),
      ),
    );
    await POST(
      jsonRequest("POST", "/api/rental-settlements", {
        type: "FAMILIA",
        periodFrom: "2026-06-01",
        periodTo: "2026-06-30",
      }),
    );

    expect(prisma.rentalSettlement.create.mock.calls[0][0].data.totalAmount).toBe(
      preview.totalAmount,
    );
  });

  it("recusa 400 quando falta from, to ou type", async () => {
    const casos: Record<string, string>[] = [
      { to: "2026-06-30", type: "DAVID" },
      { from: "2026-06-01", type: "DAVID" },
      { from: "2026-06-01", to: "2026-06-30" },
      { from: "2026-06-01", to: "2026-06-30", type: "OUTRO" },
    ];

    for (const query of casos) {
      const { status, body } = await readJson(
        await PREVIEW(getRequest("/api/rental-settlements/preview", query)),
      );
      expect(status).toBe(400);
      expect(body.error).toContain("Informe from, to e type");
    }
    expect(prisma.seasonalRental.findMany).not.toHaveBeenCalled();
  });
});
