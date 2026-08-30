import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { DELETE, PUT } from "@/app/api/seasonal-rentals/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

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
    transactionId: "tx-receita",
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

function editar(corpo: Record<string, unknown> = corpoValido, id = "rent-1") {
  return PUT(jsonRequest("PUT", `/api/seasonal-rentals/${id}`, corpo), routeParams({ id }));
}

describe("PUT /api/seasonal-rentals/[id]", () => {
  beforeEach(() => {
    prisma.seasonalRental.findUnique.mockResolvedValue(registro());
    prisma.seasonalRental.update.mockResolvedValue(registro());
    prisma.transaction.update.mockResolvedValue({});
  });

  it("atualiza o aluguel e devolve os valores recalculados", async () => {
    const { status, body } = await readJson(await editar());

    expect(status).toBe(200);
    expect(body.computed.totalDavid).toBe(250);
    expect(prisma.seasonalRental.update.mock.calls[0][0].where).toEqual({ id: "rent-1" });
  });

  it("responde 404 quando o aluguel não existe", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue(null);

    const { status, body } = await readJson(await editar(corpoValido, "nao-existe"));

    expect(status).toBe(404);
    expect(body.error).toContain("não encontrado");
    expect(prisma.seasonalRental.update).not.toHaveBeenCalled();
  });

  it("substitui os gastos extras por completo (delete + recreate)", async () => {
    await editar({ ...corpoValido, expenses: [{ description: "Gás", amount: 60 }] });

    expect(prisma.seasonalRentalExpense.deleteMany).toHaveBeenCalledWith({
      where: { seasonalRentalId: "rent-1" },
    });
    expect(prisma.seasonalRental.update.mock.calls[0][0].data.expenses).toEqual({
      create: [{ description: "Gás", amount: 60 }],
    });
    // A limpeza acontece antes da recriação.
    expect(prisma.seasonalRentalExpense.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.seasonalRental.update.mock.invocationCallOrder[0],
    );
  });

  it("lista de gastos vazia apaga todos os extras", async () => {
    await editar({ ...corpoValido, expenses: [] });

    expect(prisma.seasonalRentalExpense.deleteMany).toHaveBeenCalled();
    expect(prisma.seasonalRental.update.mock.calls[0][0].data.expenses).toEqual({ create: [] });
  });

  it("substitui por completo o mapa de diárias customizadas", async () => {
    await editar({ ...corpoValido, nightRateOverrides: { "2026-06-09": 240 } });

    expect(prisma.seasonalRental.update.mock.calls[0][0].data.nightRateOverrides).toEqual({
      "2026-06-09": 240,
    });
  });

  it("mapa de diárias vazio faz todas as noites voltarem para a tabela", async () => {
    await editar({ ...corpoValido, nightRateOverrides: {} });

    expect(prisma.seasonalRental.update.mock.calls[0][0].data.nightRateOverrides).toEqual({});
  });

  it("descarta diárias de noites que saíram do período ao mudar as datas", async () => {
    await editar({
      ...corpoValido,
      checkIn: "2026-06-09",
      nightRateOverrides: { "2026-06-08": 200, "2026-06-09": 210 },
    });

    expect(prisma.seasonalRental.update.mock.calls[0][0].data.nightRateOverrides).toEqual({
      "2026-06-09": 210,
    });
  });

  it("atualiza a transação de receita vinculada com o novo Total David", async () => {
    await editar({ ...corpoValido, netAmountReceived: 2000 });

    // 2000 − 200 − 180 − 420 = 1200 de extra → David = 200 + 600
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "tx-receita" },
      data: {
        date: new Date(2026, 5, 12),
        description: expect.stringContaining("Airbnb"),
        amount: 800,
      },
    });
  });

  it("não tenta atualizar transação quando o aluguel não tem uma vinculada", async () => {
    prisma.seasonalRental.update.mockResolvedValue(registro({ transactionId: null }));

    await editar();

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it("não quebra se a transação vinculada já foi apagada à mão", async () => {
    prisma.transaction.update.mockRejectedValue(new Error("Record to update not found"));

    const { status } = await readJson(await editar());

    expect(status).toBe(200);
  });

  it("permite editar um aluguel já repassado, sem mexer no repasse fechado", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue(
      registro({ davidSettlementId: "set-1", familiaSettlementId: "set-2" }),
    );
    prisma.seasonalRental.update.mockResolvedValue(
      registro({ davidSettlementId: "set-1", familiaSettlementId: "set-2" }),
    );

    const { status, body } = await readJson(await editar({ ...corpoValido, netAmountReceived: 2000 }));

    expect(status).toBe(200);
    expect(body.isDavidSettled).toBe(true);
    // O valor do repasse já fechado é permanente: nada é atualizado nele.
    expect(prisma.rentalSettlement.update).not.toHaveBeenCalled();
    expect(prisma.rentalSettlement.updateMany).not.toHaveBeenCalled();
  });

  it("converte as datas sem cair no bug de fuso", async () => {
    await editar();

    const data = prisma.seasonalRental.update.mock.calls[0][0].data;
    expect(data.checkIn).toEqual(new Date(2026, 5, 8));
    expect(data.checkOut).toEqual(new Date(2026, 5, 11));
  });

  it("aceita observação", async () => {
    await editar({ ...corpoValido, notes: "hóspede recorrente" });
    expect(prisma.seasonalRental.update.mock.calls[0][0].data.notes).toBe("hóspede recorrente");
  });

  it("limpa a observação quando ela vem nula ou ausente", async () => {
    await editar({ ...corpoValido, notes: null });
    expect(prisma.seasonalRental.update.mock.calls[0][0].data.notes).toBeNull();

    await editar(corpoValido);
    expect(prisma.seasonalRental.update.mock.calls[1][0].data.notes).toBeNull();
  });

  it("recusa corpo inválido com 400 sem tocar no banco", async () => {
    for (const corpo of [
      { ...corpoValido, platform: "VRBO" },
      { ...corpoValido, netAmountReceived: -1 },
      { platform: "AIRBNB", checkIn: "2026-06-08" },
    ]) {
      const { status } = await readJson(await editar(corpo));
      expect(status).toBe(400);
    }
    expect(prisma.seasonalRental.update).not.toHaveBeenCalled();
    expect(prisma.seasonalRentalExpense.deleteMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/seasonal-rentals/[id]", () => {
  it("apaga o aluguel e a transação de receita vinculada", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue({ transactionId: "tx-receita" });
    prisma.transaction.delete.mockResolvedValue({});

    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/seasonal-rentals/rent-1"), routeParams({ id: "rent-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: "tx-receita" } });
    expect(prisma.seasonalRental.delete).toHaveBeenCalledWith({ where: { id: "rent-1" } });
  });

  it("apaga o aluguel mesmo sem transação vinculada", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue({ transactionId: null });

    const { status } = await readJson(
      await DELETE(deleteRequest("/api/seasonal-rentals/rent-1"), routeParams({ id: "rent-1" })),
    );

    expect(status).toBe(200);
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
    expect(prisma.seasonalRental.delete).toHaveBeenCalled();
  });

  it("apaga o aluguel mesmo quando ele já não existe (findUnique nulo)", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue(null);

    const { status } = await readJson(
      await DELETE(deleteRequest("/api/seasonal-rentals/rent-1"), routeParams({ id: "rent-1" })),
    );

    expect(status).toBe(200);
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });

  it("não trava quando a transação vinculada já foi apagada à mão", async () => {
    prisma.seasonalRental.findUnique.mockResolvedValue({ transactionId: "tx-apagada" });
    prisma.transaction.delete.mockRejectedValue(new Error("Record to delete does not exist"));

    const { status } = await readJson(
      await DELETE(deleteRequest("/api/seasonal-rentals/rent-1"), routeParams({ id: "rent-1" })),
    );

    expect(status).toBe(200);
    expect(prisma.seasonalRental.delete).toHaveBeenCalled();
  });
});
