import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, PATCH as PATCH_COLLECTION, POST } from "@/app/api/categories/route";
import { DELETE, PATCH } from "@/app/api/categories/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

describe("GET /api/categories", () => {
  it("lista as categorias na ordem escolhida pelo usuário, com o nome de desempate", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-1", name: "Alimentação" }]);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "cat-1", name: "Alimentação" }]);
    // O nome é o SEGUNDO critério de propósito: sortOrder nasce 0 para todas,
    // então antes da primeira reordenação a lista sai em ordem alfabética.
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  it("devolve lista vazia quando não há categoria", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    const { body } = await readJson(await GET());
    expect(body).toEqual([]);
  });
});

describe("POST /api/categories", () => {
  it("cria a categoria e responde 201", async () => {
    prisma.category.create.mockResolvedValue({ id: "cat-nova", name: "Pets" });

    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/categories", { name: "Pets" })),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "cat-nova", name: "Pets" });
  });

  it("aplica os padrões de cor, ícone, tipo, palavras-chave e flag do orçamento", async () => {
    prisma.category.create.mockResolvedValue({});

    await POST(jsonRequest("POST", "/api/categories", { name: "Pets" }));

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: {
        name: "Pets",
        color: "#6366f1",
        icon: "tag",
        kind: "EXPENSE",
        keywords: [],
        deductsFromFreeSpend: false,
        // Sem nenhuma categoria no banco, a primeira nasce na posição 0.
        sortOrder: 0,
      },
    });
  });

  it("respeita os valores informados no lugar dos padrões", async () => {
    prisma.category.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/categories", {
        name: "Salário",
        color: "#16a34a",
        icon: "wallet",
        kind: "INCOME",
        keywords: ["SALARIO"],
        deductsFromFreeSpend: true,
      }),
    );

    expect(prisma.category.create).toHaveBeenCalledWith({
      data: {
        name: "Salário",
        color: "#16a34a",
        icon: "wallet",
        kind: "INCOME",
        keywords: ["SALARIO"],
        deductsFromFreeSpend: true,
        sortOrder: 0,
      },
    });
  });

  it("põe a categoria nova no fim da ordem existente", async () => {
    // A maior posição em uso é 4, então a nova entra em 5 — nascer com o
    // padrão 0 faria ela pular para o topo de todas as listas do app.
    prisma.category.findFirst.mockResolvedValue({ sortOrder: 4 });
    prisma.category.create.mockResolvedValue({});

    await POST(jsonRequest("POST", "/api/categories", { name: "Pets" }));

    expect(prisma.category.findFirst).toHaveBeenCalledWith({
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    expect(prisma.category.create.mock.calls[0][0].data.sortOrder).toBe(5);
  });

  it("recusa nome vazio com 400", async () => {
    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/categories", { name: "" })),
    );

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it("recusa corpo sem nome com 400", async () => {
    const { status } = await readJson(await POST(jsonRequest("POST", "/api/categories", {})));
    expect(status).toBe(400);
  });

  it("recusa tipo de categoria inválido com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/categories", { name: "X", kind: "OUTRO" })),
    );
    expect(status).toBe(400);
  });
});

describe("PATCH /api/categories/[id]", () => {
  it("atualiza só os campos enviados", async () => {
    prisma.category.update.mockResolvedValue({ id: "cat-1", name: "Novo nome" });

    const { status, body } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/categories/cat-1", { name: "Novo nome" }),
        routeParams({ id: "cat-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(body.name).toBe("Novo nome");
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { name: "Novo nome" },
    });
  });

  it("aceita atualizar a flag de desconto do 'livre para gastar'", async () => {
    prisma.category.update.mockResolvedValue({});

    await PATCH(
      jsonRequest("PATCH", "/api/categories/cat-1", { deductsFromFreeSpend: true }),
      routeParams({ id: "cat-1" }),
    );

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { deductsFromFreeSpend: true },
    });
  });

  it("aceita corpo vazio (nada a alterar)", async () => {
    prisma.category.update.mockResolvedValue({});
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/categories/cat-1", {}),
        routeParams({ id: "cat-1" }),
      ),
    );
    expect(status).toBe(200);
  });

  it("recusa nome vazio com 400", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/categories/cat-1", { name: "" }),
        routeParams({ id: "cat-1" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it("recusa tipo inválido com 400", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/categories/cat-1", { kind: "NENHUM" }),
        routeParams({ id: "cat-1" }),
      ),
    );
    expect(status).toBe(400);
  });
});

describe("DELETE /api/categories/[id]", () => {
  it("exclui a categoria e desassocia as transações que a usavam", async () => {
    prisma.category.findUnique.mockResolvedValue({ name: "Pets", fixedSubItems: [] });

    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/categories/cat-1"), routeParams({ id: "cat-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    // As transações ficam sem categoria em vez de serem apagadas junto.
    expect(prisma.transaction.updateMany).toHaveBeenCalledWith({
      where: { categoryId: "cat-1" },
      data: { categoryId: null },
    });
    expect(prisma.category.delete).toHaveBeenCalledWith({ where: { id: "cat-1" } });
  });

  it("responde 404 quando a categoria não existe", async () => {
    prisma.category.findUnique.mockResolvedValue(null);

    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/categories/nao-existe"), routeParams({ id: "nao-existe" })),
    );

    expect(status).toBe(404);
    expect(body.error).toContain("não encontrada");
    expect(prisma.category.delete).not.toHaveBeenCalled();
  });

  it("bloqueia com 400 a exclusão de categoria com sub-itens fixos", async () => {
    // É a regra que protege a automação de sub-itens (ex: categoria "Viagem").
    prisma.category.findUnique.mockResolvedValue({
      name: "Viagem",
      fixedSubItems: ["Comida", "Transporte"],
    });

    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/categories/cat-viagem"), routeParams({ id: "cat-viagem" })),
    );

    expect(status).toBe(400);
    expect(body.error).toContain("Viagem");
    expect(body.error).toContain("sub-itens fixos");
    expect(prisma.category.delete).not.toHaveBeenCalled();
    expect(prisma.transaction.updateMany).not.toHaveBeenCalled();
  });

  it("busca a categoria trazendo só o que a regra precisa", async () => {
    prisma.category.findUnique.mockResolvedValue({ name: "Pets", fixedSubItems: [] });

    await DELETE(deleteRequest("/api/categories/cat-1"), routeParams({ id: "cat-1" }));

    expect(prisma.category.findUnique).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      select: { name: true, fixedSubItems: true },
    });
  });
});

describe("PATCH /api/categories (reordenação)", () => {
  /** Configura o banco com as categorias existentes e a lista devolvida no fim. */
  function comCategorias(ids: string[]) {
    prisma.category.findMany
      .mockResolvedValueOnce(ids.map((id) => ({ id })))
      .mockResolvedValueOnce(ids.map((id) => ({ id, sortOrder: 0 })));
    prisma.category.update.mockResolvedValue({});
  }

  it("grava a posição de cada categoria conforme a ordem enviada", async () => {
    comCategorias(["cat-1", "cat-2", "cat-3"]);

    const { status } = await readJson(
      await PATCH_COLLECTION(
        jsonRequest("PATCH", "/api/categories", { order: ["cat-3", "cat-1", "cat-2"] }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: "cat-3" },
      data: { sortOrder: 0 },
    });
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: "cat-1" },
      data: { sortOrder: 1 },
    });
    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: "cat-2" },
      data: { sortOrder: 2 },
    });
  });

  it("aplica todas as posições numa transação só", async () => {
    comCategorias(["cat-1", "cat-2"]);

    await PATCH_COLLECTION(jsonRequest("PATCH", "/api/categories", { order: ["cat-2", "cat-1"] }));

    // Ou a ordem nova vale inteira, ou o banco fica como estava — sem isso uma
    // falha no meio deixaria duas categorias na mesma posição.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("devolve a lista já reordenada", async () => {
    prisma.category.findMany
      .mockResolvedValueOnce([{ id: "cat-1" }, { id: "cat-2" }])
      .mockResolvedValueOnce([
        { id: "cat-2", name: "Lazer", sortOrder: 0 },
        { id: "cat-1", name: "Alimentação", sortOrder: 1 },
      ]);
    prisma.category.update.mockResolvedValue({});

    const { body } = await readJson(
      await PATCH_COLLECTION(jsonRequest("PATCH", "/api/categories", { order: ["cat-2", "cat-1"] })),
    );

    expect(body.map((c: { id: string }) => c.id)).toEqual(["cat-2", "cat-1"]);
    expect(prisma.category.findMany).toHaveBeenLastCalledWith({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  });

  it("recusa 400 quando a ordem não traz todas as categorias", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-1" }, { id: "cat-2" }]);

    const { status, body } = await readJson(
      await PATCH_COLLECTION(jsonRequest("PATCH", "/api/categories", { order: ["cat-1"] })),
    );

    expect(status).toBe(400);
    expect(body.error).toContain("todas as categorias");
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it("recusa 400 quando a ordem traz um id repetido", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-1" }, { id: "cat-2" }]);

    const { status } = await readJson(
      await PATCH_COLLECTION(
        jsonRequest("PATCH", "/api/categories", { order: ["cat-1", "cat-1"] }),
      ),
    );

    expect(status).toBe(400);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it("recusa 400 quando a ordem traz um id que não existe", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-1" }, { id: "cat-2" }]);

    const { status } = await readJson(
      await PATCH_COLLECTION(
        jsonRequest("PATCH", "/api/categories", { order: ["cat-1", "cat-fantasma"] }),
      ),
    );

    expect(status).toBe(400);
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it("recusa 400 quando o corpo não tem a lista de ordem", async () => {
    const { status, body } = await readJson(
      await PATCH_COLLECTION(jsonRequest("PATCH", "/api/categories", {})),
    );

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
  });

  it("recusa 400 quando a lista de ordem vem vazia", async () => {
    const { status } = await readJson(
      await PATCH_COLLECTION(jsonRequest("PATCH", "/api/categories", { order: [] })),
    );

    expect(status).toBe(400);
  });
});
