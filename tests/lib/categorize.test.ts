import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { suggestCategoryId } from "@/lib/categorize";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";

beforeEach(resetPrismaMock);

describe("suggestCategoryId", () => {
  it("acha a categoria cuja palavra-chave aparece na descrição", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-transporte", keywords: ["UBER", "99APP"] },
      { id: "cat-comida", keywords: ["IFOOD"] },
    ]);
    await expect(suggestCategoryId("UBER *TRIP 123")).resolves.toBe("cat-transporte");
  });

  it("ignora a caixa das letras nos dois lados da comparação", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-comida", keywords: ["ifood"] }]);
    await expect(suggestCategoryId("Pagamento IFOOD junho")).resolves.toBe("cat-comida");
  });

  it("devolve null quando nenhuma palavra-chave bate", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-transporte", keywords: ["UBER"] }]);
    await expect(suggestCategoryId("PADARIA CENTRAL")).resolves.toBeNull();
  });

  it("devolve null quando não há categoria cadastrada", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await expect(suggestCategoryId("QUALQUER COISA")).resolves.toBeNull();
  });

  it("devolve a PRIMEIRA categoria que bate, na ordem em que vieram do banco", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-a", keywords: ["MERCADO"] },
      { id: "cat-b", keywords: ["MERCADO"] },
    ]);
    await expect(suggestCategoryId("MERCADO BH")).resolves.toBe("cat-a");
  });

  it("pula categoria sem palavra-chave sem quebrar", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-sem-keywords", keywords: [] },
      { id: "cat-com-keyword", keywords: ["POSTO"] },
    ]);
    await expect(suggestCategoryId("POSTO SHELL")).resolves.toBe("cat-com-keyword");
  });

  it("ignora palavra-chave vazia (que casaria com qualquer descrição)", async () => {
    // Uma keyword "" faria `includes("")` devolver true e categorizar tudo
    // errado — o guard `if (keyword && ...)` existe exatamente para isso.
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-vazia", keywords: [""] },
      { id: "cat-certa", keywords: ["FARMACIA"] },
    ]);
    await expect(suggestCategoryId("FARMACIA POPULAR")).resolves.toBe("cat-certa");
  });

  it("devolve null (e não a categoria vazia) quando só existe keyword vazia", async () => {
    prisma.category.findMany.mockResolvedValue([{ id: "cat-vazia", keywords: [""] }]);
    await expect(suggestCategoryId("QUALQUER")).resolves.toBeNull();
  });

  it("busca no banco somente id e keywords", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await suggestCategoryId("X");
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      select: { id: true, keywords: true },
    });
  });
});
