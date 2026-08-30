import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET } from "@/app/api/budget/summary/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { readJson } from "../helpers/http";

/**
 * A regra 15/10/75 é sempre do MÊS CORRENTE (não recebe parâmetro de período,
 * por design), então o relógio é fixado em todos os testes. E o valor
 * "disponível" é sempre recalculado do zero — nada de saldo acumulado.
 */
beforeEach(() => {
  resetPrismaMock();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Configura as duas consultas da rota: receitas e despesas descontáveis. */
function comTransacoes(receitas: number[], despesas: number[]) {
  prisma.transaction.findMany
    .mockResolvedValueOnce(receitas.map((amount) => ({ amount: String(amount) })))
    .mockResolvedValueOnce(despesas.map((amount) => ({ amount: String(amount) })));
}

describe("GET /api/budget/summary", () => {
  it("divide a receita do mês em 15/10/75", async () => {
    comTransacoes([10000], []);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body.totalIncome).toBe(10000);
    expect(body.freeToSpend).toEqual({
      percent: 15,
      allocated: 1500,
      spent: 0,
      available: 1500,
    });
    expect(body.tithe).toEqual({ percent: 10, amount: 1000 });
    expect(body.investment).toEqual({ percent: 75, amount: 7500 });
  });

  it("subtrai do 'disponível' só os gastos das categorias marcadas", async () => {
    comTransacoes([10000], [200, 300.5]);

    const { body } = await readJson(await GET());

    expect(body.freeToSpend.spent).toBe(500.5);
    expect(body.freeToSpend.available).toBe(999.5);
  });

  it("permite disponível negativo (estourou a fatia dos 15%)", async () => {
    comTransacoes([1000], [500]);

    const { body } = await readJson(await GET());

    expect(body.freeToSpend.allocated).toBe(150);
    expect(body.freeToSpend.available).toBe(-350);
  });

  it("soma várias receitas do mês", async () => {
    comTransacoes([5000, 3000, 2000], []);
    const { body } = await readJson(await GET());
    expect(body.totalIncome).toBe(10000);
  });

  it("devolve tudo zerado quando não há transação no mês", async () => {
    comTransacoes([], []);

    const { body } = await readJson(await GET());

    expect(body.totalIncome).toBe(0);
    expect(body.freeToSpend.available).toBe(0);
    expect(body.tithe.amount).toBe(0);
    expect(body.investment.amount).toBe(0);
  });

  it("informa o período do mês corrente", async () => {
    comTransacoes([], []);
    const { body } = await readJson(await GET());
    expect(body.periodFrom).toBe("2026-08-01");
    expect(body.periodTo).toBe("2026-08-31");
  });

  it("acerta o período em mês de 30 dias", async () => {
    vi.setSystemTime(new Date(2026, 3, 10, 12, 0, 0));
    comTransacoes([], []);
    const { body } = await readJson(await GET());
    expect(body.periodFrom).toBe("2026-04-01");
    expect(body.periodTo).toBe("2026-04-30");
  });

  it("acerta o período em fevereiro de ano bissexto", async () => {
    vi.setSystemTime(new Date(2028, 1, 10, 12, 0, 0));
    comTransacoes([], []);
    const { body } = await readJson(await GET());
    expect(body.periodTo).toBe("2028-02-29");
  });

  it("busca receitas do mês e despesas só de categoria descontável", async () => {
    comTransacoes([], []);

    await GET();

    const [receitasArgs, despesasArgs] = prisma.transaction.findMany.mock.calls.map(
      (c: unknown[]) => c[0] as any,
    );
    expect(receitasArgs.where.type).toBe("INCOME");
    expect(receitasArgs.where.date.gte).toEqual(new Date(2026, 7, 1));
    expect(receitasArgs.where).not.toHaveProperty("category");

    expect(despesasArgs.where.type).toBe("EXPENSE");
    expect(despesasArgs.where.category).toEqual({ deductsFromFreeSpend: true });
  });

  it("busca só o campo de valor (não precisa do resto da transação)", async () => {
    comTransacoes([], []);
    await GET();
    for (const call of prisma.transaction.findMany.mock.calls) {
      expect(call[0].select).toEqual({ amount: true });
    }
  });

  it("converte Decimal do banco (string no JSON) para número", async () => {
    prisma.transaction.findMany
      .mockResolvedValueOnce([{ amount: "1234.56" }])
      .mockResolvedValueOnce([{ amount: "34.56" }]);

    const { body } = await readJson(await GET());

    expect(body.totalIncome).toBeCloseTo(1234.56, 10);
    expect(body.freeToSpend.spent).toBeCloseTo(34.56, 10);
  });

  it("ignora pagamentos de fatura (só INCOME conta como receita)", async () => {
    comTransacoes([], []);
    await GET();
    const receitasArgs = prisma.transaction.findMany.mock.calls[0][0];
    // A rota nunca consulta PAYMENT.
    expect(receitasArgs.where.type).not.toBe("PAYMENT");
  });
});
