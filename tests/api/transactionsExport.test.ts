import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET } from "@/app/api/transactions/export/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { getRequest } from "../helpers/http";

beforeEach(resetPrismaMock);

function tx(over: Record<string, unknown> = {}) {
  return {
    date: new Date(2026, 7, 15),
    description: "SUPERMERCADO BH",
    amount: "150.00",
    type: "EXPENSE",
    category: { name: "Supermercado" },
    creditCard: null,
    ...over,
  };
}

/**
 * Roda a rota e devolve o CSV.
 *
 * Lê o corpo como bytes (`arrayBuffer`) em vez de `text()` de propósito: o
 * `text()` do `Response` remove o BOM inicial por especificação, e o BOM é
 * justamente uma das coisas que precisam ser testadas aqui (é ele que faz o
 * Excel abrir os acentos corretamente).
 */
async function exportar(transacoes: unknown[], query?: Record<string, string>) {
  prisma.transaction.findMany.mockResolvedValue(transacoes);
  const res = await GET(getRequest("/api/transactions/export", query));
  const bytes = Buffer.from(await res.arrayBuffer());
  const texto = bytes.toString("utf8");
  return { res, bytes, texto, linhas: texto.replace(/^﻿/, "").split("\n") };
}

describe("GET /api/transactions/export", () => {
  it("gera o CSV com cabeçalho e uma linha por transação", async () => {
    const { linhas } = await exportar([tx()]);

    expect(linhas[0]).toBe("Data;Descrição;Categoria;Cartão;Tipo;Valor (BRL)");
    // O valor sai entre aspas porque o separador decimal brasileiro é a
    // vírgula, e a regra de escape de CSV envolve em aspas qualquer célula
    // que contenha vírgula. É CSV válido e o Excel lê normalmente.
    expect(linhas[1]).toBe('2026-08-15;SUPERMERCADO BH;Supermercado;;EXPENSE;"150,00"');
  });

  it("usa ponto e vírgula como separador (o Excel em português espera isso)", async () => {
    const { linhas } = await exportar([tx()]);
    expect(linhas[0].split(";")).toHaveLength(6);
  });

  it("usa vírgula decimal no valor", async () => {
    const { linhas } = await exportar([tx({ amount: "1234.5" })]);
    expect(linhas[1]).toContain("1234,50");
  });

  it("começa com BOM UTF-8 (senão o Excel quebra os acentos)", async () => {
    const { bytes } = await exportar([tx()]);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("força o download como arquivo CSV", async () => {
    const { res } = await exportar([tx()]);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="transacoes.csv"');
  });

  it("deixa a coluna de categoria vazia quando não há categoria", async () => {
    const { linhas } = await exportar([tx({ category: null })]);
    expect(linhas[1]).toBe(`2026-08-15;SUPERMERCADO BH;;;EXPENSE;"150,00"`);
  });

  it("mostra banco e últimos dígitos do cartão", async () => {
    const { linhas } = await exportar([
      tx({ creditCard: { bank: "Santander", lastDigits: "8258" } }),
    ]);
    expect(linhas[1]).toContain("Santander ****8258");
  });

  it("escapa descrição com ponto e vírgula, aspas ou quebra de linha", async () => {
    const { linhas } = await exportar([
      tx({ description: 'LOJA "A", FILIAL' }),
      tx({ description: "LINHA1\nLINHA2" }),
    ]);

    // Vírgula e aspas: o campo é envolvido em aspas e as internas duplicadas.
    expect(linhas[1]).toContain('"LOJA ""A"", FILIAL"');
    // Quebra de linha também obriga a envolver em aspas.
    expect(linhas[2]).toContain('"LINHA1');
  });

  it("não escapa descrição simples", async () => {
    const { linhas } = await exportar([tx({ description: "PADARIA CENTRAL" })]);
    expect(linhas[1]).toContain("PADARIA CENTRAL");
    expect(linhas[1]).not.toContain('"PADARIA');
  });

  it("exporta só o cabeçalho quando não há transação", async () => {
    const { linhas } = await exportar([]);
    expect(linhas).toHaveLength(1);
  });

  it("aplica o filtro de período com o dia final inteiro", async () => {
    await exportar([], { from: "2026-08-01", to: "2026-08-31" });

    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(where.date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("aceita só o início do período", async () => {
    await exportar([], { from: "2026-08-01" });
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toEqual(new Date(2026, 7, 1));
    expect(where.date.lte).toBeUndefined();
  });

  it("aceita só o fim do período", async () => {
    await exportar([], { to: "2026-08-31" });
    const where = prisma.transaction.findMany.mock.calls[0][0].where;
    expect(where.date.gte).toBeUndefined();
    expect(where.date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("aplica o filtro de categorias", async () => {
    await exportar([], { categoryIds: "cat-1,cat-2" });
    expect(prisma.transaction.findMany.mock.calls[0][0].where.categoryId).toEqual({
      in: ["cat-1", "cat-2"],
    });
  });

  it("filtra só as sem categoria com o pseudo-id none", async () => {
    await exportar([], { categoryIds: "none" });
    expect(prisma.transaction.findMany.mock.calls[0][0].where.categoryId).toBeNull();
  });

  it("combina categorias e 'sem categoria' com OR", async () => {
    await exportar([], { categoryIds: "cat-1,none" });
    expect(prisma.transaction.findMany.mock.calls[0][0].where.OR).toEqual([
      { categoryId: { in: ["cat-1"] } },
      { categoryId: null },
    ]);
  });

  it("seleção explicitamente vazia não exporta nada", async () => {
    await exportar([], { categoryIds: "" });
    expect(prisma.transaction.findMany.mock.calls[0][0].where.id).toBe(
      "__no_category_selected__",
    );
  });

  it("exporta em ordem cronológica crescente", async () => {
    await exportar([]);
    expect(prisma.transaction.findMany.mock.calls[0][0].orderBy).toEqual({ date: "asc" });
  });
});
