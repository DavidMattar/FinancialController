import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET } from "@/app/api/budget/summary/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { getRequest, readJson } from "../helpers/http";

/**
 * A rota aceita o período por query string (`/receitas` manda o mês escolhido
 * nos seletores do título, o dashboard manda o período do DateRangePicker) e,
 * SEM parâmetro, continua respondendo pelo mês corrente — por isso o relógio
 * é fixado em todos os testes. A conta em si (fatias e acúmulo mês a mês) é do
 * `src/lib/budget.ts` e tem teste próprio; aqui o foco é o que a rota consulta
 * no banco e o que ela faz com os parâmetros.
 */
beforeEach(() => {
  resetPrismaMock();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Uma transação como o Prisma devolve para esta rota: Decimal em string + data. */
function tx(valor: number, data = new Date(2026, 7, 10)) {
  return { amount: String(valor), date: data };
}

/** Configura as duas consultas da rota: receitas e despesas descontáveis. */
function comTransacoes(receitas: unknown[], despesas: unknown[]) {
  prisma.transaction.findMany.mockResolvedValueOnce(receitas).mockResolvedValueOnce(despesas);
}

/** Chama a rota com (ou sem) parâmetros de período. */
async function chamar(query?: Record<string, string>) {
  return readJson(await GET(getRequest("/api/budget/summary", query)));
}

describe("GET /api/budget/summary — mês corrente (sem parâmetro)", () => {
  it("divide a receita do mês em 15/10/75", async () => {
    comTransacoes([tx(10000)], []);

    const { status, body } = await chamar();

    expect(status).toBe(200);
    expect(body.totalIncome).toBe(10000);
    expect(body.freeToSpend).toEqual({ percent: 15, allocated: 1500, spent: 0, available: 1500 });
    expect(body.tithe).toEqual({ percent: 10, amount: 1000 });
    expect(body.investment).toEqual({ percent: 75, amount: 7500 });
  });

  it("informa o período do mês corrente", async () => {
    comTransacoes([], []);
    const { body } = await chamar();
    expect(body.periodFrom).toBe("2026-08-01");
    expect(body.periodTo).toBe("2026-08-31");
  });

  it("acerta o período em mês de 30 dias", async () => {
    vi.setSystemTime(new Date(2026, 3, 10, 12, 0, 0));
    comTransacoes([], []);
    const { body } = await chamar();
    expect(body.periodFrom).toBe("2026-04-01");
    expect(body.periodTo).toBe("2026-04-30");
  });

  it("acerta o período em fevereiro de ano bissexto", async () => {
    vi.setSystemTime(new Date(2028, 1, 10, 12, 0, 0));
    comTransacoes([], []);
    const { body } = await chamar();
    expect(body.periodTo).toBe("2028-02-29");
  });

  it("busca até o FIM do último dia do mês", async () => {
    comTransacoes([], []);

    await GET(getRequest("/api/budget/summary"));

    const filtro = prisma.transaction.findMany.mock.calls[0][0].where.date;
    expect(filtro.gte).toEqual(new Date(2026, 7, 1));
    // Fim do dia, não meia-noite: uma transação lançada às 22h do dia 31 conta.
    expect(filtro.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
  });

  it("devolve um único mês no detalhamento", async () => {
    comTransacoes([tx(10000)], [tx(500.5)]);

    const { body } = await chamar();

    expect(body.months).toEqual([
      {
        month: "2026-08",
        income: 10000,
        allocated: 1500,
        spent: 500.5,
        monthAvailable: 999.5,
        cumulativeAvailable: 999.5,
      },
    ]);
  });
});

describe("GET /api/budget/summary — período informado", () => {
  it("usa o from/to recebidos no filtro do banco", async () => {
    comTransacoes([], []);

    await GET(getRequest("/api/budget/summary", { from: "2026-06-01", to: "2026-08-31" }));

    for (const call of prisma.transaction.findMany.mock.calls) {
      expect(call[0].where.date.gte).toEqual(new Date(2026, 5, 1));
      expect(call[0].where.date.lte).toEqual(new Date(2026, 7, 31, 23, 59, 59, 999));
    }
  });

  it("devolve o período recebido, não o mês corrente", async () => {
    comTransacoes([], []);

    const { body } = await chamar({ from: "2026-06-01", to: "2026-08-31" });

    expect(body.periodFrom).toBe("2026-06-01");
    expect(body.periodTo).toBe("2026-08-31");
  });

  it("acumula a fatia dos 15% mês a mês dentro do período", async () => {
    // R$ 100 de receita por mês (15% = R$ 15) e R$ 32 gastos no primeiro mês.
    comTransacoes(
      [tx(100, new Date(2026, 5, 5)), tx(100, new Date(2026, 6, 5)), tx(100, new Date(2026, 7, 5))],
      [tx(32, new Date(2026, 5, 20))],
    );

    const { body } = await chamar({ from: "2026-06-01", to: "2026-08-31" });

    expect(body.months.map((m: { cumulativeAvailable: number }) => m.cumulativeAvailable)).toEqual([
      -17, -2, 13,
    ]);
    expect(body.freeToSpend.available).toBeCloseTo(13, 10);
  });

  it("aceita só o 'from' (o 'até' segue sendo o fim do mês corrente)", async () => {
    comTransacoes([], []);

    const { body } = await chamar({ from: "2026-07-01" });

    expect(body.periodFrom).toBe("2026-07-01");
    expect(body.periodTo).toBe("2026-08-31");
  });

  it("aceita só o 'to' (o 'de' segue sendo o dia 1º do mês corrente)", async () => {
    comTransacoes([], []);

    const { body } = await chamar({ to: "2026-08-20" });

    expect(body.periodFrom).toBe("2026-08-01");
    expect(body.periodTo).toBe("2026-08-20");
  });

  it("não cai no bug de fuso: 1º de janeiro continua sendo 1º de janeiro", async () => {
    comTransacoes([], []);

    await GET(getRequest("/api/budget/summary", { from: "2026-01-01", to: "2026-01-31" }));

    // `new Date("2026-01-01")` viraria 31/12/2025 no horário de Brasília.
    expect(prisma.transaction.findMany.mock.calls[0][0].where.date.gte).toEqual(new Date(2026, 0, 1));
  });

  it("recusa 'from' fora do formato YYYY-MM-DD", async () => {
    const { status, body } = await chamar({ from: "01/06/2026" });

    expect(status).toBe(400);
    expect(body.error).toContain("from");
    // Recusar em vez de cair no mês corrente: período errado silencioso é pior.
    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("recusa 'to' fora do formato YYYY-MM-DD", async () => {
    const { status, body } = await chamar({ from: "2026-06-01", to: "agosto" });

    expect(status).toBe(400);
    expect(body.error).toContain("to");
  });

  it("recusa 'from' vazio (parâmetro presente mas sem valor)", async () => {
    const { status } = await chamar({ from: "" });
    expect(status).toBe(400);
  });
});

describe("GET /api/budget/summary — o que é consultado no banco", () => {
  it("busca receitas do mês e despesas só de categoria descontável", async () => {
    comTransacoes([], []);

    await GET(getRequest("/api/budget/summary"));

    const [receitasArgs, despesasArgs] = prisma.transaction.findMany.mock.calls.map(
      (c: unknown[]) => c[0] as any,
    );
    expect(receitasArgs.where.type).toBe("INCOME");
    expect(receitasArgs.where).not.toHaveProperty("category");

    expect(despesasArgs.where.type).toBe("EXPENSE");
    expect(despesasArgs.where.category).toEqual({ deductsFromFreeSpend: true });
  });

  it("busca só valor e data (o resto da transação não é usado)", async () => {
    comTransacoes([], []);
    await GET(getRequest("/api/budget/summary"));
    for (const call of prisma.transaction.findMany.mock.calls) {
      expect(call[0].select).toEqual({ amount: true, date: true });
    }
  });

  it("converte Decimal do banco (string no JSON) para número", async () => {
    comTransacoes([tx(1234.56)], [tx(34.56)]);

    const { body } = await chamar();

    expect(body.totalIncome).toBeCloseTo(1234.56, 10);
    expect(body.freeToSpend.spent).toBeCloseTo(34.56, 10);
  });

  it("ignora pagamentos de fatura (só INCOME conta como receita)", async () => {
    comTransacoes([], []);
    await GET(getRequest("/api/budget/summary"));
    const receitasArgs = prisma.transaction.findMany.mock.calls[0][0];
    // A rota nunca consulta PAYMENT.
    expect(receitasArgs.where.type).not.toBe("PAYMENT");
  });
});
