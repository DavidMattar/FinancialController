import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET } from "@/app/api/transactions/metrics/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { getRequest, readJson } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Transação como o Prisma devolve: Decimal serializado e `date` como Date. */
function tx(over: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    date: new Date(2026, 7, 15),
    description: "SUPERMERCADO BH",
    amount: "100.00",
    type: "EXPENSE",
    category: { id: "cat-1", name: "Supermercado", color: "#22c55e" },
    ...over,
  };
}

async function metricas(transacoes: unknown[], query?: Record<string, string>) {
  prisma.transaction.findMany.mockResolvedValue(transacoes);
  const { body } = await readJson(await GET(getRequest("/api/transactions/metrics", query)));
  return body;
}

describe("GET /api/transactions/metrics — totais", () => {
  it("soma as despesas e conta quantas são", async () => {
    const m = await metricas([tx(), tx({ id: "tx-2", amount: "50.50" })]);
    expect(m.totalExpense).toBe(150.5);
    expect(m.transactionCount).toBe(2);
  });

  it("calcula o ticket médio das despesas", async () => {
    const m = await metricas([tx({ amount: "100" }), tx({ id: "tx-2", amount: "200" })]);
    expect(m.averageTicket).toBe(150);
  });

  it("ticket médio é zero quando não há despesa (sem divisão por zero)", async () => {
    const m = await metricas([]);
    expect(m.averageTicket).toBe(0);
    expect(m.totalExpense).toBe(0);
    expect(m.transactionCount).toBe(0);
  });

  it("soma as receitas separadamente das despesas", async () => {
    const m = await metricas([
      tx({ amount: "100", type: "EXPENSE" }),
      tx({ id: "tx-2", amount: "5000", type: "INCOME" }),
    ]);
    expect(m.totalExpense).toBe(100);
    expect(m.totalIncome).toBe(5000);
    // A receita não entra na contagem de despesas nem no ticket médio.
    expect(m.transactionCount).toBe(1);
  });

  it("ignora pagamento de fatura nos dois totais", async () => {
    const m = await metricas([tx({ amount: "2000", type: "PAYMENT" })]);
    expect(m.totalExpense).toBe(0);
    expect(m.totalIncome).toBe(0);
    expect(m.byCategory).toEqual([]);
  });
});

describe("GET /api/transactions/metrics — agrupamentos", () => {
  it("agrupa despesas por categoria, da maior para a menor", async () => {
    const m = await metricas([
      tx({ amount: "100", category: { id: "cat-1", name: "Supermercado", color: "#22c55e" } }),
      tx({ id: "t2", amount: "300", category: { id: "cat-2", name: "Lazer", color: "#14b8a6" } }),
      tx({ id: "t3", amount: "50", category: { id: "cat-1", name: "Supermercado", color: "#22c55e" } }),
    ]);

    expect(m.byCategory).toEqual([
      { name: "Lazer", color: "#14b8a6", total: 300 },
      { name: "Supermercado", color: "#22c55e", total: 150 },
    ]);
  });

  it("usa 'Sem categoria' e cor cinza para transação sem categoria", async () => {
    const m = await metricas([tx({ category: null })]);
    expect(m.byCategory).toEqual([{ name: "Sem categoria", color: "#94a3b8", total: 100 }]);
  });

  it("agrupa receitas por categoria em uma lista própria", async () => {
    const m = await metricas([
      tx({ amount: "5000", type: "INCOME", category: { id: "c-sal", name: "Salário", color: "#16a34a" } }),
      tx({ id: "t2", amount: "300", type: "INCOME", category: { id: "c-alu", name: "Aluguel", color: "#000" } }),
    ]);

    expect(m.byCategoryIncome).toEqual([
      { name: "Salário", color: "#16a34a", total: 5000 },
      { name: "Aluguel", color: "#000", total: 300 },
    ]);
    expect(m.byCategory).toEqual([]);
  });

  it("agrupa despesas por mês, em ordem cronológica", async () => {
    const m = await metricas([
      tx({ date: new Date(2026, 7, 15), amount: "100" }),
      tx({ id: "t2", date: new Date(2026, 5, 10), amount: "200" }),
      tx({ id: "t3", date: new Date(2026, 7, 20), amount: "50" }),
    ]);

    expect(m.byMonth).toEqual([
      { month: "2026-06", total: 200 },
      { month: "2026-08", total: 150 },
    ]);
  });

  it("preenche o mês com zero à esquerda", async () => {
    const m = await metricas([tx({ date: new Date(2026, 0, 5) })]);
    expect(m.byMonth[0].month).toBe("2026-01");
  });

  it("usa a data local no agrupamento por mês (transação do dia 1º não cai no mês anterior)", async () => {
    // 01/08/2026 à meia-noite local: em UTC ainda seria 31/07.
    const m = await metricas([tx({ date: new Date(2026, 7, 1, 0, 0, 0) })]);
    expect(m.byMonth[0].month).toBe("2026-08");
  });

  it("soma os maiores gastos por descrição, da maior para a menor", async () => {
    const m = await metricas([
      tx({ description: "UBER", amount: "30" }),
      tx({ id: "t2", description: "IFOOD", amount: "80" }),
      tx({ id: "t3", description: "UBER", amount: "40" }),
    ]);

    expect(m.topMerchants).toEqual([
      { description: "IFOOD", total: 80 },
      { description: "UBER", total: 70 },
    ]);
  });

  it("limita os maiores gastos a 10 estabelecimentos", async () => {
    const transacoes = Array.from({ length: 15 }, (_, i) =>
      tx({ id: `t${i}`, description: `LOJA ${i}`, amount: String(i + 1) }),
    );
    const m = await metricas(transacoes);

    expect(m.topMerchants).toHaveLength(10);
    // O maior valor vem primeiro.
    expect(m.topMerchants[0]).toEqual({ description: "LOJA 14", total: 15 });
  });

  it("não inclui receitas nos maiores gastos", async () => {
    const m = await metricas([tx({ type: "INCOME", description: "SALARIO", amount: "5000" })]);
    expect(m.topMerchants).toEqual([]);
  });
});

describe("GET /api/transactions/metrics — filtros", () => {
  function where() {
    return prisma.transaction.findMany.mock.calls[0][0].where;
  }

  it("sem filtro nenhum, busca tudo", async () => {
    await metricas([]);
    expect(where()).toEqual({});
  });

  it("filtra por período com o dia final inteiro", async () => {
    await metricas([], { from: "2026-08-01", to: "2026-08-31" });
    expect(where().date.gte).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
    expect(where().date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("aceita só o início do período", async () => {
    await metricas([], { from: "2026-08-01" });
    expect(where().date.gte).toEqual(new Date(2026, 7, 1));
    expect(where().date.lte).toBeUndefined();
  });

  it("aceita só o fim do período", async () => {
    await metricas([], { to: "2026-08-31" });
    expect(where().date.gte).toBeUndefined();
    expect(where().date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("filtra por lista de categorias", async () => {
    await metricas([], { categoryIds: "cat-1,cat-2" });
    expect(where().categoryId).toEqual({ in: ["cat-1", "cat-2"] });
  });

  it("filtra só as sem categoria quando a lista é apenas 'none'", async () => {
    await metricas([], { categoryIds: "none" });
    expect(where().categoryId).toBeNull();
  });

  it("combina categorias e 'sem categoria' com OR", async () => {
    await metricas([], { categoryIds: "cat-1,none" });
    expect(where().OR).toEqual([{ categoryId: { in: ["cat-1"] } }, { categoryId: null }]);
  });

  it("seleção explicitamente vazia não casa com nada", async () => {
    // É o caso de o usuário desmarcar todas as categorias na tela.
    await metricas([], { categoryIds: "" });
    expect(where().id).toBe("__no_category_selected__");
  });

  it("ignora ids vazios entre as vírgulas", async () => {
    await metricas([], { categoryIds: "cat-1,,cat-2," });
    expect(where().categoryId).toEqual({ in: ["cat-1", "cat-2"] });
  });

  it("traz a categoria junto para poder agrupar por nome e cor", async () => {
    await metricas([]);
    expect(prisma.transaction.findMany.mock.calls[0][0].include).toEqual({ category: true });
  });
});
