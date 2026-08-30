import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { deriveReferenceMonthFromFilename, suggestCategoriesBulk } from "@/lib/invoices";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";

beforeEach(resetPrismaMock);

describe("deriveReferenceMonthFromFilename", () => {
  it("extrai mês e ano do padrão MMYYYY usado pelo Santander", () => {
    expect(deriveReferenceMonthFromFilename("Fatura_082026_cartao.pdf")).toBe("2026-08");
  });

  it("funciona com o nome de arquivo real do banco", () => {
    expect(
      deriveReferenceMonthFromFilename("Fatura_082026_DAVID_8258_MASTER_00166075912887.PDF"),
    ).toBe("2026-08");
  });

  it("usa a primeira ocorrência quando o nome tem vários grupos de dígitos", () => {
    expect(deriveReferenceMonthFromFilename("012025_e_022026.pdf")).toBe("2025-01");
  });

  it("acha o padrão no meio de uma sequência maior de dígitos", () => {
    // A regex não exige delimitador, então casa nos 6 primeiros dígitos.
    expect(deriveReferenceMonthFromFilename("fatura122024extra.pdf")).toBe("2024-12");
  });

  describe("quando o nome do arquivo não tem o padrão", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("cai no mês atual", () => {
      expect(deriveReferenceMonthFromFilename("fatura.pdf")).toBe("2026-08");
    });

    it("preenche o mês com zero à esquerda", () => {
      vi.setSystemTime(new Date(2026, 2, 5, 12, 0, 0));
      expect(deriveReferenceMonthFromFilename("sem-numeros.pdf")).toBe("2026-03");
    });

    it("cai no mês atual quando há dígitos, mas não 6 seguidos", () => {
      expect(deriveReferenceMonthFromFilename("fatura_12_2026.pdf")).toBe("2026-08");
    });
  });
});

describe("suggestCategoriesBulk", () => {
  it("consulta o banco UMA vez só, mesmo com muitas descrições", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await suggestCategoriesBulk(["A", "B", "C", "D", "E"]);
    expect(prisma.category.findMany).toHaveBeenCalledTimes(1);
  });

  it("devolve a categoria completa (id, nome e cor) de cada descrição", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-1", name: "Transporte", color: "#3b82f6", keywords: ["UBER"] },
    ]);
    const mapa = await suggestCategoriesBulk(["UBER *TRIP"]);
    expect(mapa.get("UBER *TRIP")).toEqual({
      id: "cat-1",
      name: "Transporte",
      color: "#3b82f6",
    });
  });

  it("devolve null para as descrições que não bateram", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-1", name: "Transporte", color: "#3b82f6", keywords: ["UBER"] },
    ]);
    const mapa = await suggestCategoriesBulk(["UBER *TRIP", "PADARIA CENTRAL"]);
    expect(mapa.get("PADARIA CENTRAL")).toBeNull();
  });

  it("tem uma entrada no Map para cada descrição de entrada", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    const mapa = await suggestCategoriesBulk(["A", "B"]);
    expect(mapa.size).toBe(2);
    expect([...mapa.keys()]).toEqual(["A", "B"]);
  });

  it("descrições repetidas compartilham a mesma entrada", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    const mapa = await suggestCategoriesBulk(["IGUAL", "IGUAL"]);
    expect(mapa.size).toBe(1);
  });

  it("ignora a caixa das letras", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-1", name: "Alimentação", color: "#f97316", keywords: ["ifood"] },
    ]);
    const mapa = await suggestCategoriesBulk(["Pedido IFOOD"]);
    expect(mapa.get("Pedido IFOOD")?.name).toBe("Alimentação");
  });

  it("usa a primeira categoria que bate, na ordem do banco", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-a", name: "A", color: "#000", keywords: ["MERCADO"] },
      { id: "cat-b", name: "B", color: "#fff", keywords: ["MERCADO"] },
    ]);
    const mapa = await suggestCategoriesBulk(["MERCADO BH"]);
    expect(mapa.get("MERCADO BH")?.id).toBe("cat-a");
  });

  it("ignora palavra-chave vazia (que casaria com tudo)", async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-vazia", name: "Vazia", color: "#000", keywords: [""] },
      { id: "cat-certa", name: "Saúde", color: "#ef4444", keywords: ["FARMACIA"] },
    ]);
    const mapa = await suggestCategoriesBulk(["FARMACIA POPULAR"]);
    expect(mapa.get("FARMACIA POPULAR")?.id).toBe("cat-certa");
  });

  it("devolve Map vazio quando a lista de descrições é vazia", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    const mapa = await suggestCategoriesBulk([]);
    expect(mapa.size).toBe(0);
  });

  it("busca no banco os campos necessários para montar o preview", async () => {
    prisma.category.findMany.mockResolvedValue([]);
    await suggestCategoriesBulk(["X"]);
    expect(prisma.category.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, color: true, keywords: true },
    });
  });
});
