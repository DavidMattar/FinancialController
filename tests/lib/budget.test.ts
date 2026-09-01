import { describe, expect, it } from "vitest";
import {
  buildBudgetSummary,
  enumerateMonths,
  monthKey,
  FREE_TO_SPEND_PERCENT,
  INVESTMENT_PERCENT,
  TITHE_PERCENT,
  type BudgetEntry,
} from "@/lib/budget";

/** Uma transação como ela sai do banco: valor em string (Decimal) e `date` como Date. */
function entrada(ano: number, mes: number, dia: number, valor: number): BudgetEntry {
  return { amount: String(valor), date: new Date(ano, mes - 1, dia) };
}

describe("monthKey", () => {
  it("devolve o mês de referência no formato YYYY-MM", () => {
    expect(monthKey(new Date(2026, 7, 15))).toBe("2026-08");
  });

  it("preenche o mês com zero à esquerda", () => {
    expect(monthKey(new Date(2026, 0, 1))).toBe("2026-01");
  });

  it("usa o calendário LOCAL, não UTC", () => {
    // 31/08 às 23h no Brasil (UTC-3) é 01/09 em UTC — o mês de referência
    // continua sendo agosto, que é o mês que o usuário reconhece.
    expect(monthKey(new Date(2026, 7, 31, 23, 30))).toBe("2026-08");
  });
});

describe("enumerateMonths", () => {
  it("lista um mês só quando o período cabe dentro dele", () => {
    expect(enumerateMonths(new Date(2026, 7, 1), new Date(2026, 7, 31))).toEqual(["2026-08"]);
  });

  it("lista todos os meses do período em ordem", () => {
    expect(enumerateMonths(new Date(2026, 5, 1), new Date(2026, 7, 31))).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("inclui meses sem nenhuma transação (não pode ter furo)", () => {
    expect(enumerateMonths(new Date(2026, 0, 15), new Date(2026, 3, 2))).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("atravessa a virada de ano", () => {
    expect(enumerateMonths(new Date(2026, 10, 1), new Date(2027, 1, 28))).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("devolve lista vazia quando 'até' é antes de 'de' (período impossível)", () => {
    expect(enumerateMonths(new Date(2026, 7, 1), new Date(2026, 5, 30))).toEqual([]);
  });
});

describe("buildBudgetSummary — as três fatias", () => {
  it("divide a receita do período em 15/10/75", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 8, 5, 10000)],
      [],
    );

    expect(resumo.totalIncome).toBe(10000);
    expect(resumo.freeToSpend).toEqual({ percent: 15, allocated: 1500, spent: 0, available: 1500 });
    expect(resumo.tithe).toEqual({ percent: 10, amount: 1000 });
    expect(resumo.investment).toEqual({ percent: 75, amount: 7500 });
  });

  it("informa o período consultado em YYYY-MM-DD", () => {
    const resumo = buildBudgetSummary(new Date(2026, 7, 1), new Date(2026, 7, 31), [], []);
    expect(resumo.periodFrom).toBe("2026-08-01");
    expect(resumo.periodTo).toBe("2026-08-31");
  });

  it("subtrai do disponível só o que foi passado como gasto descontável", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 8, 5, 10000)],
      [entrada(2026, 8, 10, 200), entrada(2026, 8, 20, 300.5)],
    );

    expect(resumo.freeToSpend.spent).toBe(500.5);
    expect(resumo.freeToSpend.available).toBe(999.5);
  });

  it("permite disponível negativo (estourou a fatia dos 15%)", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 8, 1, 1000)],
      [entrada(2026, 8, 2, 500)],
    );

    expect(resumo.freeToSpend.allocated).toBe(150);
    expect(resumo.freeToSpend.available).toBe(-350);
  });

  it("devolve tudo zerado quando não há transação no período", () => {
    const resumo = buildBudgetSummary(new Date(2026, 7, 1), new Date(2026, 7, 31), [], []);

    expect(resumo.totalIncome).toBe(0);
    expect(resumo.freeToSpend.available).toBe(0);
    expect(resumo.tithe.amount).toBe(0);
    expect(resumo.investment.amount).toBe(0);
    expect(resumo.months).toEqual([
      { month: "2026-08", income: 0, allocated: 0, spent: 0, monthAvailable: 0, cumulativeAvailable: 0 },
    ]);
  });

  it("converte Decimal do banco (string) para número", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 8, 5, 1234.56)],
      [entrada(2026, 8, 6, 34.56)],
    );

    expect(resumo.totalIncome).toBeCloseTo(1234.56, 10);
    expect(resumo.freeToSpend.spent).toBeCloseTo(34.56, 10);
  });

  it("os percentuais das fatias são os do módulo (15/10/75)", () => {
    expect(FREE_TO_SPEND_PERCENT).toBe(0.15);
    expect(TITHE_PERCENT).toBe(0.1);
    expect(INVESTMENT_PERCENT).toBe(0.75);
  });
});

describe("buildBudgetSummary — acúmulo mês a mês", () => {
  /**
   * O exemplo que definiu a regra: receita de R$ 100/mês (15% = R$ 15/mês) e
   * R$ 32 gastos no primeiro mês. O estouro atravessa os meses seguintes em
   * vez de ser zerado na virada — no fim do 2º mês o acumulado é −R$ 2 e no
   * fim do 3º, sem gastar nada, volta a +R$ 13.
   */
  it("carrega o estouro de um mês para os seguintes", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 5, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 6, 5, 100), entrada(2026, 7, 5, 100), entrada(2026, 8, 5, 100)],
      [entrada(2026, 6, 20, 32)],
    );

    expect(resumo.months.map((m) => m.cumulativeAvailable)).toEqual([-17, -2, 13]);
    expect(resumo.freeToSpend.available).toBeCloseTo(13, 10);
  });

  it("detalha receita, alocado e gasto de cada mês", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 5, 1),
      new Date(2026, 6, 31),
      [entrada(2026, 6, 5, 100), entrada(2026, 7, 5, 200)],
      [entrada(2026, 6, 20, 32)],
    );

    expect(resumo.months).toEqual([
      { month: "2026-06", income: 100, allocated: 15, spent: 32, monthAvailable: -17, cumulativeAvailable: -17 },
      { month: "2026-07", income: 200, allocated: 30, spent: 0, monthAvailable: 30, cumulativeAvailable: 13 },
    ]);
  });

  it("soma várias transações do mesmo mês numa linha só", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 7, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 8, 1, 5000), entrada(2026, 8, 10, 3000), entrada(2026, 8, 20, 2000)],
      [entrada(2026, 8, 3, 100), entrada(2026, 8, 4, 50)],
    );

    expect(resumo.months).toHaveLength(1);
    expect(resumo.months[0].income).toBe(10000);
    expect(resumo.months[0].spent).toBe(150);
  });

  it("mês sem receita nenhuma entra zerado e só desconta o que foi gasto", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 5, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 6, 5, 100)],
      [entrada(2026, 7, 10, 5)],
    );

    expect(resumo.months.map((m) => m.income)).toEqual([100, 0, 0]);
    expect(resumo.months.map((m) => m.cumulativeAvailable)).toEqual([15, 10, 10]);
  });

  it("sobra de um mês aumenta o disponível do mês seguinte", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 5, 1),
      new Date(2026, 6, 31),
      [entrada(2026, 6, 5, 100), entrada(2026, 7, 5, 100)],
      [entrada(2026, 7, 10, 20)],
    );

    // 15 sobrados em junho absorvem os 20 gastos em julho: acumulado +10.
    expect(resumo.months.map((m) => m.cumulativeAvailable)).toEqual([15, 10]);
  });

  it("o acumulado do último mês fecha com o disponível do período", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
      Array.from({ length: 12 }, (_, i) => entrada(2026, i + 1, 10, 1000)),
      [entrada(2026, 3, 5, 700), entrada(2026, 9, 8, 250.75)],
    );

    expect(resumo.months).toHaveLength(12);
    expect(resumo.months[11].cumulativeAvailable).toBeCloseTo(resumo.freeToSpend.available, 10);
  });

  it("o total do período é a soma dos meses (as duas visões não podem divergir)", () => {
    const resumo = buildBudgetSummary(
      new Date(2026, 5, 1),
      new Date(2026, 7, 31),
      [entrada(2026, 6, 5, 100), entrada(2026, 8, 5, 300)],
      [entrada(2026, 7, 1, 10)],
    );

    const somaMeses = resumo.months.reduce((s, m) => s + m.income, 0);
    expect(resumo.totalIncome).toBeCloseTo(somaMeses, 10);
    expect(resumo.freeToSpend.allocated).toBeCloseTo(resumo.totalIncome * 0.15, 10);
  });

  it("período impossível (até antes de de) devolve nenhum mês e tudo zerado", () => {
    const resumo = buildBudgetSummary(new Date(2026, 7, 1), new Date(2026, 5, 30), [], []);

    expect(resumo.months).toEqual([]);
    expect(resumo.totalIncome).toBe(0);
    expect(resumo.freeToSpend.available).toBe(0);
  });
});
