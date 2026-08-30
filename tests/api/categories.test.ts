import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/categories/route";
import { DELETE, PATCH } from "@/app/api/categories/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

describe("GET /api/categories", () => {
  it("lista as categorias ordenadas por nome", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-1", name: "Alimentação" }]);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "cat-1", name: "Alimentação" }]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
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
      },
    });
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
