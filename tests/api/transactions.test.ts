import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/transactions/route";
import { DELETE, PATCH } from "@/app/api/transactions/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, getRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Filtros aplicados pelo GET, extraídos da chamada ao Prisma. */
function whereDoGet() {
  return prisma.transaction.findMany.mock.calls[0][0].where;
}

describe("GET /api/transactions", () => {
  it("lista as transações com categoria e cartão, da mais recente para a mais antiga", async () => {
    prisma.transaction.findMany.mockResolvedValue([{ id: "tx-1" }]);

    const { status, body } = await readJson(await GET(getRequest("/api/transactions")));

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "tx-1" }]);
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: {},
      include: { category: true, creditCard: true },
      orderBy: { date: "desc" },
    });
  });

  it("filtra por período, incluindo o dia final inteiro", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);

    await GET(getRequest("/api/transactions", { from: "2026-08-01", to: "2026-08-31" }));

    expect(whereDoGet().date.gte).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(whereDoGet().date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("aceita só o início do período", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { from: "2026-08-01" }));
    expect(whereDoGet().date.gte).toEqual(new Date(2026, 7, 1));
    expect(whereDoGet().date.lte).toBeUndefined();
  });

  it("aceita só o fim do período", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { to: "2026-08-31" }));
    expect(whereDoGet().date.gte).toBeUndefined();
    expect(whereDoGet().date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("filtra por categoria", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { categoryId: "cat-1" }));
    expect(whereDoGet().categoryId).toBe("cat-1");
  });

  it("filtra por 'sem categoria' com o pseudo-id none", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { categoryId: "none" }));
    expect(whereDoGet().categoryId).toBeNull();
  });

  it("filtra por tipo", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { type: "INCOME" }));
    expect(whereDoGet().type).toBe("INCOME");
  });

  it("filtra por cartão", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { cardId: "card-1" }));
    expect(whereDoGet().creditCardId).toBe("card-1");
  });

  it("busca por texto na descrição, ignorando a caixa", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { q: "uber" }));
    expect(whereDoGet().description).toEqual({ contains: "uber", mode: "insensitive" });
  });

  it("filtra as pendências de devolução só quando o valor é 'true'", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { pendingReturn: "true" }));
    expect(whereDoGet().pendingReturn).toBe(true);
  });

  it("ignora pendingReturn com qualquer outro valor", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { pendingReturn: "false" }));
    expect(whereDoGet()).not.toHaveProperty("pendingReturn");
  });

  it("combina vários filtros ao mesmo tempo", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);

    await GET(
      getRequest("/api/transactions", {
        from: "2026-08-01",
        categoryId: "cat-1",
        type: "EXPENSE",
        cardId: "card-1",
        q: "mercado",
        pendingReturn: "true",
      }),
    );

    const where = whereDoGet();
    expect(where.categoryId).toBe("cat-1");
    expect(where.type).toBe("EXPENSE");
    expect(where.creditCardId).toBe("card-1");
    expect(where.description).toEqual({ contains: "mercado", mode: "insensitive" });
    expect(where.pendingReturn).toBe(true);
    expect(where.date.gte).toBeInstanceOf(Date);
  });

  it("ignora filtro vazio na querystring", async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    await GET(getRequest("/api/transactions", { categoryId: "", type: "", q: "", cardId: "" }));
    expect(whereDoGet()).toEqual({});
  });
});

describe("POST /api/transactions", () => {
  const corpoValido = { date: "2026-08-15", description: "PADARIA", amount: 12.5 };

  beforeEach(() => {
    prisma.transaction.create.mockResolvedValue({ id: "tx-nova" });
    prisma.category.findMany.mockResolvedValue([]);
    prisma.category.findUnique.mockResolvedValue(null);
  });

  it("grava pendingReturn quando o formulário marca a verificação de devolução", async () => {
    await POST(jsonRequest("POST", "/api/transactions", { ...corpoValido, pendingReturn: true }));

    expect(prisma.transaction.create.mock.calls[0][0].data.pendingReturn).toBe(true);
  });

  it("pendingReturn é false quando não vem no corpo", async () => {
    await POST(jsonRequest("POST", "/api/transactions", corpoValido));

    expect(prisma.transaction.create.mock.calls[0][0].data.pendingReturn).toBe(false);
  });

  it("aceita pendingReturn em qualquer tipo e descrição (sem trava de e-commerce)", async () => {
    // A lista de ecommerceMerchants.ts filtra a UI do painel da transação já
    // criada; na criação quem decide o que acompanhar é o usuário.
    await POST(
      jsonRequest("POST", "/api/transactions", {
        ...corpoValido,
        description: "PADARIA DA ESQUINA",
        type: "INCOME",
        pendingReturn: true,
      }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.pendingReturn).toBe(true);
  });

  it("recusa pendingReturn que não é booleano", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/transactions", { ...corpoValido, pendingReturn: "sim" })),
    );

    expect(status).toBe(400);
  });

  it("cria a transação como MANUAL e responde 201", async () => {
    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/transactions", corpoValido)),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "tx-nova" });
    expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
      description: "PADARIA",
      amount: 12.5,
      type: "EXPENSE",
      source: "MANUAL",
    });
  });

  it("converte a data sem cair no bug de fuso", async () => {
    await POST(jsonRequest("POST", "/api/transactions", corpoValido));
    expect(prisma.transaction.create.mock.calls[0][0].data.date).toEqual(new Date(2026, 7, 15));
  });

  it("sugere a categoria automaticamente quando o usuário não escolheu", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-comida", keywords: ["PADARIA"] }]);
    prisma.category.findUnique.mockResolvedValue({ kind: "EXPENSE", fixedSubItems: [] });

    await POST(jsonRequest("POST", "/api/transactions", corpoValido));

    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBe("cat-comida");
  });

  it("não sobrescreve a categoria escolhida pelo usuário", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-sugerida", keywords: ["PADARIA"] }]);
    prisma.category.findUnique.mockResolvedValue({ kind: "EXPENSE", fixedSubItems: [] });

    await POST(
      jsonRequest("POST", "/api/transactions", { ...corpoValido, categoryId: "cat-escolhida" }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBe("cat-escolhida");
    // Nem chega a consultar as keywords.
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it("grava sem categoria quando nada bate", async () => {
    await POST(jsonRequest("POST", "/api/transactions", corpoValido));
    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBeNull();
  });

  it("sem categoria, nem consulta o tipo dela (pula a regra de receita)", async () => {
    prisma.category.findMany.mockResolvedValue([]);

    await POST(jsonRequest("POST", "/api/transactions", corpoValido));

    // É o caminho em que `if (categoryId)` é falso: nenhuma consulta de kind.
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create.mock.calls[0][0].data.type).toBe("EXPENSE");
  });

  it("categoria explicitamente nula também pula a regra de receita", async () => {
    prisma.category.findMany.mockResolvedValue([]);

    await POST(jsonRequest("POST", "/api/transactions", { ...corpoValido, categoryId: null }));

    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBeNull();
  });

  it("categoria de receita força o tipo para INCOME", async () => {
    prisma.category.findUnique.mockResolvedValue({ kind: "INCOME", fixedSubItems: [] });

    await POST(
      jsonRequest("POST", "/api/transactions", {
        ...corpoValido,
        categoryId: "cat-salario",
        type: "EXPENSE",
      }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.type).toBe("INCOME");
  });

  it("categoria de despesa mantém o tipo enviado", async () => {
    prisma.category.findUnique.mockResolvedValue({ kind: "EXPENSE", fixedSubItems: [] });

    await POST(
      jsonRequest("POST", "/api/transactions", {
        ...corpoValido,
        categoryId: "cat-1",
        type: "PAYMENT",
      }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.type).toBe("PAYMENT");
  });

  it("mantém o tipo quando a categoria não existe mais", async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    await POST(
      jsonRequest("POST", "/api/transactions", { ...corpoValido, categoryId: "cat-apagada" }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.type).toBe("EXPENSE");
  });

  it("cria os sub-itens fixos da categoria", async () => {
    prisma.category.findUnique.mockResolvedValue({ kind: "EXPENSE", fixedSubItems: ["Comida"] });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await POST(
      jsonRequest("POST", "/api/transactions", { ...corpoValido, categoryId: "cat-viagem" }),
    );

    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [{ transactionId: "tx-nova", description: "Comida", amount: 0 }],
    });
  });

  it("guarda cartão e observação quando informados", async () => {
    await POST(
      jsonRequest("POST", "/api/transactions", {
        ...corpoValido,
        creditCardId: "card-1",
        notes: "parcelado",
      }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
      creditCardId: "card-1",
      notes: "parcelado",
    });
  });

  it("usa null para cartão e observação ausentes", async () => {
    await POST(jsonRequest("POST", "/api/transactions", corpoValido));
    expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
      creditCardId: null,
      notes: null,
    });
  });

  it("recusa valor zero ou negativo com 400", async () => {
    for (const amount of [0, -10]) {
      const { status } = await readJson(
        await POST(jsonRequest("POST", "/api/transactions", { ...corpoValido, amount })),
      );
      expect(status).toBe(400);
    }
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("recusa descrição vazia, data ausente e tipo inválido com 400", async () => {
    const casos = [
      { ...corpoValido, description: "" },
      { description: "X", amount: 1 },
      { ...corpoValido, type: "TRANSFERENCIA" },
    ];
    for (const corpo of casos) {
      const { status } = await readJson(
        await POST(jsonRequest("POST", "/api/transactions", corpo)),
      );
      expect(status).toBe(400);
    }
  });
});

describe("PATCH /api/transactions/[id]", () => {
  beforeEach(() => {
    prisma.transaction.update.mockResolvedValue({ id: "tx-1" });
    prisma.category.findUnique.mockResolvedValue(null);
  });

  it("atualiza só os campos enviados", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/transactions/tx-1", { description: "Novo" }),
        routeParams({ id: "tx-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.transaction.update.mock.calls[0][0].data).toEqual({ description: "Novo" });
  });

  it("converte a data quando ela é enviada", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { date: "2026-01-31" }),
      routeParams({ id: "tx-1" }),
    );
    expect(prisma.transaction.update.mock.calls[0][0].data.date).toEqual(new Date(2026, 0, 31));
  });

  it("nova categoria de receita força o tipo para INCOME", async () => {
    prisma.category.findUnique.mockResolvedValue({ kind: "INCOME", fixedSubItems: [] });

    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", {
        categoryId: "cat-salario",
        type: "EXPENSE",
      }),
      routeParams({ id: "tx-1" }),
    );

    expect(prisma.transaction.update.mock.calls[0][0].data.type).toBe("INCOME");
  });

  it("permite remover a categoria (null) sem consultar o tipo dela", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { categoryId: null }),
      routeParams({ id: "tx-1" }),
    );

    expect(prisma.transaction.update.mock.calls[0][0].data.categoryId).toBeNull();
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    // E não tenta criar sub-item fixo de categoria nenhuma.
    expect(prisma.transactionItem.createMany).not.toHaveBeenCalled();
  });

  it("não inclui o campo type quando ele não foi enviado", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { amount: 99 }),
      routeParams({ id: "tx-1" }),
    );
    expect(prisma.transaction.update.mock.calls[0][0].data).toEqual({ amount: 99 });
  });

  it("sincroniza os sub-itens fixos quando a categoria muda", async () => {
    prisma.category.findUnique.mockResolvedValue({ kind: "EXPENSE", fixedSubItems: ["Estadia"] });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { categoryId: "cat-viagem" }),
      routeParams({ id: "tx-1" }),
    );

    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [{ transactionId: "tx-1", description: "Estadia", amount: 0 }],
    });
  });

  it("marca e desmarca a pendência de devolução", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { pendingReturn: true }),
      routeParams({ id: "tx-1" }),
    );
    expect(prisma.transaction.update.mock.calls[0][0].data.pendingReturn).toBe(true);
  });

  it("aceita limpar a observação com null", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { notes: null }),
      routeParams({ id: "tx-1" }),
    );
    expect(prisma.transaction.update.mock.calls[0][0].data.notes).toBeNull();
  });

  it("devolve a transação com categoria e cartão populados", async () => {
    await PATCH(
      jsonRequest("PATCH", "/api/transactions/tx-1", { amount: 1 }),
      routeParams({ id: "tx-1" }),
    );
    expect(prisma.transaction.update.mock.calls[0][0].include).toEqual({
      category: true,
      creditCard: true,
    });
  });

  it("recusa valor negativo e descrição vazia com 400", async () => {
    for (const corpo of [{ amount: -1 }, { description: "" }]) {
      const { status } = await readJson(
        await PATCH(
          jsonRequest("PATCH", "/api/transactions/tx-1", corpo),
          routeParams({ id: "tx-1" }),
        ),
      );
      expect(status).toBe(400);
    }
    expect(prisma.transaction.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/transactions/[id]", () => {
  it("exclui a transação", async () => {
    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/transactions/tx-1"), routeParams({ id: "tx-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.transaction.delete).toHaveBeenCalledWith({ where: { id: "tx-1" } });
  });
});
