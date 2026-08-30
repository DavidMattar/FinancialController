import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentMonthRange,
  currentYearRange,
  lastMonthRange,
  lastNMonthsRange,
} from "@/lib/dateRanges";

/**
 * Todas as funções deste módulo leem `new Date()`, então os testes fixam o
 * relógio. A data escolhida (15/08/2026, meio-dia) é propositalmente no meio
 * do mês e do ano, para nenhum teste passar por coincidência de borda.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("currentMonthRange", () => {
  it("vai do primeiro ao último dia do mês atual", () => {
    expect(currentMonthRange()).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("acerta o último dia em mês de 30 dias", () => {
    vi.setSystemTime(new Date(2026, 3, 10, 12, 0, 0));
    expect(currentMonthRange()).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("acerta fevereiro de ano bissexto", () => {
    vi.setSystemTime(new Date(2028, 1, 10, 12, 0, 0));
    expect(currentMonthRange()).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("acerta fevereiro de ano não bissexto", () => {
    vi.setSystemTime(new Date(2026, 1, 10, 12, 0, 0));
    expect(currentMonthRange()).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("funciona no primeiro dia do mês", () => {
    vi.setSystemTime(new Date(2026, 7, 1, 0, 30, 0));
    expect(currentMonthRange()).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("funciona no último dia do ano", () => {
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30, 0));
    expect(currentMonthRange()).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});

describe("lastMonthRange", () => {
  it("vai do primeiro ao último dia do mês anterior", () => {
    expect(lastMonthRange()).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });

  it("atravessa a virada de ano (janeiro -> dezembro anterior)", () => {
    vi.setSystemTime(new Date(2026, 0, 10, 12, 0, 0));
    expect(lastMonthRange()).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("acerta o mês anterior com 28 dias", () => {
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0));
    expect(lastMonthRange()).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("lastNMonthsRange", () => {
  it("inclui o mês atual completo (3 meses = jun a ago)", () => {
    expect(lastNMonthsRange(3)).toEqual({ from: "2026-06-01", to: "2026-08-31" });
  });

  it("com n = 1 é igual ao mês atual", () => {
    expect(lastNMonthsRange(1)).toEqual(currentMonthRange());
  });

  it("atravessa a virada de ano", () => {
    expect(lastNMonthsRange(12)).toEqual({ from: "2025-09-01", to: "2026-08-31" });
  });

  it("aceita n maior que 12", () => {
    expect(lastNMonthsRange(18)).toEqual({ from: "2025-03-01", to: "2026-08-31" });
  });
});

describe("currentYearRange", () => {
  it("vai de 1º de janeiro a 31 de dezembro do ano atual", () => {
    expect(currentYearRange()).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("usa o ano do relógio, não um ano fixo", () => {
    vi.setSystemTime(new Date(2030, 5, 5, 12, 0, 0));
    expect(currentYearRange()).toEqual({ from: "2030-01-01", to: "2030-12-31" });
  });
});
