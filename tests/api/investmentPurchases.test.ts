import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { DELETE } from "@/app/api/investments/[id]/purchases/[purchaseId]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Chama a rota para o par (ativo, compra) informado. */
function apagar(holdingId = "hold-1", purchaseId = "buy-1") {
  return DELETE(
    deleteRequest(`/api/investments/${holdingId}/purchases/${purchaseId}`),
    routeParams({ id: holdingId, purchaseId }),
  );
}

describe("DELETE /api/investments/[id]/purchases/[purchaseId]", () => {
  it("apaga a compra e mantém o ativo quando ainda sobram outras", async () => {
    prisma.investmentPurchase.findFirst.mockResolvedValue({ id: "buy-1", holdingId: "hold-1" });
    prisma.investmentPurchase.count.mockResolvedValue(2);

    const { status, body } = await readJson(await apagar());

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, holdingDeleted: false });
    expect(prisma.investmentPurchase.delete).toHaveBeenCalledWith({ where: { id: "buy-1" } });
    expect(prisma.investmentHolding.delete).not.toHaveBeenCalled();
  });

  it("apagar a última compra apaga o ativo junto", async () => {
    // Posição sem compra nenhuma apareceria zerada na tabela, indistinguível de
    // um ativo realmente sem saldo — é um registro fantasma.
    prisma.investmentPurchase.findFirst.mockResolvedValue({ id: "buy-1", holdingId: "hold-1" });
    prisma.investmentPurchase.count.mockResolvedValue(0);

    const { status, body } = await readJson(await apagar());

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, holdingDeleted: true });
    expect(prisma.investmentHolding.delete).toHaveBeenCalledWith({ where: { id: "hold-1" } });
  });

  it("as duas exclusões acontecem na mesma transação do Postgres", async () => {
    // Sem isso, uma falha entre elas deixaria exatamente o registro fantasma.
    prisma.investmentPurchase.findFirst.mockResolvedValue({ id: "buy-1", holdingId: "hold-1" });
    prisma.investmentPurchase.count.mockResolvedValue(0);

    await apagar();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("procura a compra dentro do ativo da URL, não só pelo id dela", async () => {
    // Uma URL com o par trocado não pode apagar a compra de outro ativo.
    prisma.investmentPurchase.findFirst.mockResolvedValue({ id: "buy-1", holdingId: "hold-1" });
    prisma.investmentPurchase.count.mockResolvedValue(1);

    await apagar("hold-9", "buy-7");

    expect(prisma.investmentPurchase.findFirst).toHaveBeenCalledWith({
      where: { id: "buy-7", holdingId: "hold-9" },
    });
  });

  it("responde 404 quando a compra não é daquele ativo", async () => {
    prisma.investmentPurchase.findFirst.mockResolvedValue(null);

    const { status, body } = await readJson(await apagar("hold-1", "buy-de-outro"));

    expect(status).toBe(404);
    expect(body.error).toContain("não encontrada");
    expect(prisma.investmentPurchase.delete).not.toHaveBeenCalled();
    expect(prisma.investmentHolding.delete).not.toHaveBeenCalled();
  });

  it("não toca no ledger de transações", async () => {
    prisma.investmentPurchase.findFirst.mockResolvedValue({ id: "buy-1", holdingId: "hold-1" });
    prisma.investmentPurchase.count.mockResolvedValue(0);

    await apagar();

    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });
});
