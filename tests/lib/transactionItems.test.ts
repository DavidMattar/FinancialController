import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { ensureFixedSubItems } from "@/lib/transactionItems";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";

beforeEach(resetPrismaMock);

describe("ensureFixedSubItems", () => {
  it("cria os sub-itens fixos da categoria com valor zero", async () => {
    prisma.category.findUnique.mockResolvedValue({
      fixedSubItems: ["Comida", "Transporte", "Estadia"],
    });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await ensureFixedSubItems("tx-1", "cat-viagem");

    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [
        { transactionId: "tx-1", description: "Comida", amount: 0 },
        { transactionId: "tx-1", description: "Transporte", amount: 0 },
        { transactionId: "tx-1", description: "Estadia", amount: 0 },
      ],
    });
  });

  it("é idempotente: não recria os sub-itens que já existem", async () => {
    prisma.category.findUnique.mockResolvedValue({
      fixedSubItems: ["Comida", "Transporte"],
    });
    prisma.transactionItem.findMany.mockResolvedValue([{ description: "Comida" }]);

    await ensureFixedSubItems("tx-1", "cat-viagem");

    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [{ transactionId: "tx-1", description: "Transporte", amount: 0 }],
    });
  });

  it("não grava nada quando todos os sub-itens já existem", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: ["Comida"] });
    prisma.transactionItem.findMany.mockResolvedValue([{ description: "Comida" }]);

    await ensureFixedSubItems("tx-1", "cat-viagem");

    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });

  it("não faz nada quando a transação não tem categoria", async () => {
    await ensureFixedSubItems("tx-1", null);
    await ensureFixedSubItems("tx-1", undefined);
    await ensureFixedSubItems("tx-1", "");

    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });

  it("não faz nada quando a categoria não define sub-itens fixos", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: [] });

    await ensureFixedSubItems("tx-1", "cat-comum");

    expect(prisma.transactionItem.findMany).not.toHaveBeenCalled();
    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });

  it("não quebra quando a categoria não existe mais", async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await expect(ensureFixedSubItems("tx-1", "cat-apagada")).resolves.toBeUndefined();
    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });

  it("busca a categoria pelo id, trazendo só os sub-itens fixos", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: [] });

    await ensureFixedSubItems("tx-1", "cat-viagem");

    expect(prisma.category.findUnique).toHaveBeenCalledWith({
      where: { id: "cat-viagem" },
      select: { fixedSubItems: true },
    });
  });

  it("consulta os itens existentes só da transação informada", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: ["Comida"] });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await ensureFixedSubItems("tx-42", "cat-viagem");

    expect(prisma.transactionItem.findMany).toHaveBeenCalledWith({
      where: { transactionId: "tx-42" },
      select: { description: true },
    });
  });

  it("compara pela descrição, então um item de mesmo nome com outro valor conta como existente", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: ["Comida"] });
    // O usuário já preencheu o valor: não deve ser duplicado nem zerado.
    prisma.transactionItem.findMany.mockResolvedValue([{ description: "Comida" }]);

    await ensureFixedSubItems("tx-1", "cat-viagem");

    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });
});
