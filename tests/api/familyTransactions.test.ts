import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/family-transactions/route";
import { DELETE, PATCH } from "@/app/api/family-transactions/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, getRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

describe("GET /api/family-transactions", () => {
  it("lista os lançamentos, do mais recente para o mais antigo", async () => {
    prisma.familyTransaction.findMany.mockResolvedValue([{ id: "fam-1" }]);

    const { status, body } = await readJson(await GET(getRequest("/api/family-transactions")));

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "fam-1" }]);
    expect(prisma.familyTransaction.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { date: "desc" },
    });
  });

  it("filtra pelo período informado, com o fim do dia incluído", async () => {
    prisma.familyTransaction.findMany.mockResolvedValue([]);

    await GET(
      getRequest("/api/family-transactions", { from: "2026-08-01", to: "2026-08-31" }),
    );

    const where = prisma.familyTransaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    // O fim do dia é essencial: senão um lançamento das 14h do dia 31 sumiria.
    expect(where.date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("aceita só o início do período", async () => {
    prisma.familyTransaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/family-transactions", { from: "2026-08-01" }));
    const where = prisma.familyTransaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(2026, 7, 1));
    expect(where.date.lte).toBeUndefined();
  });

  it("aceita só o fim do período", async () => {
    prisma.familyTransaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/family-transactions", { to: "2026-08-31" }));
    const where = prisma.familyTransaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toBeUndefined();
    expect(where.date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });
});

describe("POST /api/family-transactions", () => {
  it("cria o lançamento e responde 201", async () => {
    prisma.familyTransaction.create.mockResolvedValue({ id: "fam-novo" });

    const { status, body } = await readJson(
      await POST(
        jsonRequest("POST", "/api/family-transactions", {
          date: "2026-08-15",
          description: "Mercado",
          amount: 250.5,
        }),
      ),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "fam-novo" });
  });

  it("converte a data sem cair no bug de fuso (não volta um dia)", async () => {
    prisma.familyTransaction.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/family-transactions", {
        date: "2026-08-15",
        description: "Mercado",
        amount: 10,
      }),
    );

    const data = prisma.familyTransaction.create.mock.calls[0][0].data;
    expect(data.date).toEqual(new Date(2026, 7, 15));
    expect(data.date.getDate()).toBe(15);
  });

  it("usa EXPENSE como tipo padrão e null como observação padrão", async () => {
    prisma.familyTransaction.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/family-transactions", {
        date: "2026-08-15",
        description: "Mercado",
        amount: 10,
      }),
    );

    expect(prisma.familyTransaction.create.mock.calls[0][0].data).toMatchObject({
      type: "EXPENSE",
      notes: null,
    });
  });

  it("aceita lançamento de receita com observação", async () => {
    prisma.familyTransaction.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/family-transactions", {
        date: "2026-08-15",
        description: "Aporte",
        amount: 1000,
        type: "INCOME",
        notes: "dividido entre os dois",
      }),
    );

    expect(prisma.familyTransaction.create.mock.calls[0][0].data).toMatchObject({
      type: "INCOME",
      notes: "dividido entre os dois",
    });
  });

  it("recusa valor zero ou negativo com 400", async () => {
    for (const amount of [0, -5]) {
      const { status } = await readJson(
        await POST(
          jsonRequest("POST", "/api/family-transactions", {
            date: "2026-08-15",
            description: "X",
            amount,
          }),
        ),
      );
      expect(status).toBe(400);
    }
    expect(prisma.familyTransaction.create).not.toHaveBeenCalled();
  });

  it("recusa descrição vazia com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/family-transactions", {
          date: "2026-08-15",
          description: "",
          amount: 10,
        }),
      ),
    );
    expect(status).toBe(400);
  });

  it("recusa corpo sem data com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/family-transactions", { description: "X", amount: 10 }),
      ),
    );
    expect(status).toBe(400);
  });

  it("recusa tipo inválido com 400", async () => {
    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/family-transactions", {
          date: "2026-08-15",
          description: "X",
          amount: 10,
          type: "PAYMENT",
        }),
      ),
    );
    expect(status).toBe(400);
  });
});

describe("PATCH /api/family-transactions/[id]", () => {
  it("atualiza só os campos enviados", async () => {
    prisma.familyTransaction.update.mockResolvedValue({ id: "fam-1" });

    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/family-transactions/fam-1", { description: "Novo" }),
        routeParams({ id: "fam-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.familyTransaction.update).toHaveBeenCalledWith({
      where: { id: "fam-1" },
      data: { description: "Novo" },
    });
  });

  it("converte a data quando ela é enviada", async () => {
    prisma.familyTransaction.update.mockResolvedValue({});

    await PATCH(
      jsonRequest("PATCH", "/api/family-transactions/fam-1", { date: "2026-01-31" }),
      routeParams({ id: "fam-1" }),
    );

    expect(prisma.familyTransaction.update.mock.calls[0][0].data.date).toEqual(
      new Date(2026, 0, 31),
    );
  });

  it("não inclui o campo date quando ele não é enviado", async () => {
    prisma.familyTransaction.update.mockResolvedValue({});

    await PATCH(
      jsonRequest("PATCH", "/api/family-transactions/fam-1", { amount: 99 }),
      routeParams({ id: "fam-1" }),
    );

    expect(prisma.familyTransaction.update.mock.calls[0][0].data).toEqual({ amount: 99 });
  });

  it("aceita limpar a observação com null", async () => {
    prisma.familyTransaction.update.mockResolvedValue({});

    await PATCH(
      jsonRequest("PATCH", "/api/family-transactions/fam-1", { notes: null }),
      routeParams({ id: "fam-1" }),
    );

    expect(prisma.familyTransaction.update.mock.calls[0][0].data).toEqual({ notes: null });
  });

  it("recusa valor negativo com 400", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/family-transactions/fam-1", { amount: -1 }),
        routeParams({ id: "fam-1" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.familyTransaction.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/family-transactions/[id]", () => {
  it("remove o lançamento", async () => {
    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/family-transactions/fam-1"), routeParams({ id: "fam-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.familyTransaction.delete).toHaveBeenCalledWith({ where: { id: "fam-1" } });
  });
});
