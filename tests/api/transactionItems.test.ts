import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/transactions/[id]/items/route";
import { DELETE, PATCH } from "@/app/api/transactions/[id]/items/[itemId]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, getRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

describe("GET /api/transactions/[id]/items", () => {
  it("lista os sub-itens da transação na ordem de criação", async () => {
    prisma.transactionItem.findMany.mockResolvedValue([{ id: "item-1", description: "Hotel" }]);

    const { status, body } = await readJson(
      await GET(getRequest("/api/transactions/tx-1/items"), routeParams({ id: "tx-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "item-1", description: "Hotel" }]);
    expect(prisma.transactionItem.findMany).toHaveBeenCalledWith({
      where: { transactionId: "tx-1" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("devolve lista vazia quando a transação não tem sub-item", async () => {
    prisma.transactionItem.findMany.mockResolvedValue([]);
    const { body } = await readJson(
      await GET(getRequest("/api/transactions/tx-1/items"), routeParams({ id: "tx-1" })),
    );
    expect(body).toEqual([]);
  });
});

describe("POST /api/transactions/[id]/items", () => {
  it("cria o sub-item vinculado à transação da URL e responde 201", async () => {
    prisma.transactionItem.create.mockResolvedValue({ id: "item-novo" });

    const { status, body } = await readJson(
      await POST(
        jsonRequest("POST", "/api/transactions/tx-1/items", {
          description: "Passagem",
          amount: 890.5,
        }),
        routeParams({ id: "tx-1" }),
      ),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "item-novo" });
    expect(prisma.transactionItem.create).toHaveBeenCalledWith({
      data: { transactionId: "tx-1", description: "Passagem", amount: 890.5 },
    });
  });

  it("não altera a transação pai (sub-item é só detalhamento visual)", async () => {
    prisma.transactionItem.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/transactions/tx-1/items", { description: "X", amount: 10 }),
      routeParams({ id: "tx-1" }),
    );

    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });

  it("recusa descrição vazia com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/transactions/tx-1/items", { description: "", amount: 10 }),
        routeParams({ id: "tx-1" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.transactionItem.create).not.toHaveBeenCalled();
  });

  it("recusa valor zero ou negativo com 400", async () => {
    for (const amount of [0, -5]) {
      const { status } = await readJson(
        await POST(
          jsonRequest("POST", "/api/transactions/tx-1/items", { description: "X", amount }),
          routeParams({ id: "tx-1" }),
        ),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa corpo sem valor com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/transactions/tx-1/items", { description: "X" }),
        routeParams({ id: "tx-1" }),
      ),
    );
    expect(status).toBe(400);
  });
});

describe("PATCH /api/transactions/[id]/items/[itemId]", () => {
  it("atualiza o sub-item pelo id dele (não pelo id da transação)", async () => {
    prisma.transactionItem.update.mockResolvedValue({ id: "item-1" });

    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/transactions/tx-1/items/item-1", { amount: 42 }),
        routeParams({ id: "tx-1", itemId: "item-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.transactionItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { amount: 42 },
    });
  });

  it("atualiza a descrição", async () => {
    prisma.transactionItem.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1/items/item-1", { description: "Hotel" }),
      routeParams({ id: "tx-1", itemId: "item-1" }),
    );
    expect(prisma.transactionItem.update.mock.calls[0][0].data).toEqual({ description: "Hotel" });
  });

  it("aceita corpo vazio", async () => {
    prisma.transactionItem.update.mockResolvedValue({});
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/transactions/tx-1/items/item-1", {}),
        routeParams({ id: "tx-1", itemId: "item-1" }),
      ),
    );
    expect(status).toBe(200);
  });

  it("recusa valor negativo e descrição vazia com 400", async () => {
    for (const corpo of [{ amount: -1 }, { description: "" }]) {
      const { status } = await readJson(
        await PATCH(
          jsonRequest("PATCH", "/api/transactions/tx-1/items/item-1", corpo),
          routeParams({ id: "tx-1", itemId: "item-1" }),
        ),
      );
      expect(status).toBe(400);
    }
    expect(prisma.transactionItem.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/transactions/[id]/items/[itemId]", () => {
  it("remove só o sub-item", async () => {
    const { status, body } = await readJson(
      await DELETE(
        deleteRequest("/api/transactions/tx-1/items/item-1"),
        routeParams({ id: "tx-1", itemId: "item-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.transactionItem.delete).toHaveBeenCalledWith({ where: { id: "item-1" } });
    expect(prisma.transaction.delete).not.toHaveBeenCalled();
  });
});
