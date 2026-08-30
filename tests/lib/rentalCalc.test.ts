import { describe, expect, it } from "vitest";
import { computeRental } from "@/lib/rentalCalc";

/**
 * Cenário base usado na maioria dos testes: 08/06/2026 a 11/06/2026 são 3
 * noites de dia de semana em baixa temporada, ou seja, valor de tabela de
 * 3 × 140 = R$ 420. Manter o valor de tabela fixo deixa cada teste isolar uma
 * variável da fórmula por vez.
 */
const checkIn = new Date(2026, 5, 8);
const checkOut = new Date(2026, 5, 11);
const TABELA = 420;

describe("computeRental — fórmula completa", () => {
  it("calcula o caso normal (reserva acima do valor de tabela)", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
    });

    expect(r.nights).toBe(3);
    expect(r.tableValue).toBe(TABELA);
    expect(r.davidTenPercent).toBe(100);
    // 1000 − 100 (10%) − 180 (limpeza) − 420 (tabela) − 0 (extras)
    expect(r.extraTableValue).toBe(300);
    // 100 + metade de 300
    expect(r.totalDavid).toBe(250);
    // 1000 − 250 − 180
    expect(r.netForDistribution).toBe(570);
  });

  it("repassa o total de extras informado", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 100,
    });
    expect(r.extrasTotal).toBe(100);
    // Os extras reduzem o "extra de tabela" e, por consequência, o total do David.
    expect(r.extraTableValue).toBe(200);
    expect(r.totalDavid).toBe(200);
    // Mas NÃO são descontados de novo da distribuição familiar.
    expect(r.netForDistribution).toBe(620);
  });

  it("as partes somadas reconstroem o valor recebido", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    expect(r.totalDavid + r.netForDistribution + 180).toBe(1000);
  });
});

describe("computeRental — os 10% são piso garantido do David", () => {
  it("não reduz o total do David quando a reserva veio abaixo da tabela", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 500,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    // 500 − 50 − 180 − 420 = −150 (negativo, reserva abaixo da tabela)
    expect(r.extraTableValue).toBe(-150);
    // O piso de 10% é mantido: a metade do valor negativo NÃO é aplicada.
    expect(r.totalDavid).toBe(50);
    expect(r.totalDavid).toBe(r.davidTenPercent);
  });

  it("a perda é absorvida inteiramente pela distribuição familiar", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 500,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    expect(r.netForDistribution).toBe(270);
    // Se os 50% negativos tivessem sido aplicados, o David ficaria com −25 e a
    // família com 345 — este teste é o que trava esse comportamento errado.
    expect(r.netForDistribution).not.toBe(345);
  });

  it("no limite exato (extra de tabela igual a zero) o David recebe só os 10%", () => {
    // Escolhido para zerar: 10% + limpeza + tabela = net → net = (180+420)/0.9
    const net = 600 / 0.9;
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: net,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    expect(r.extraTableValue).toBeCloseTo(0, 10);
    expect(r.totalDavid).toBeCloseTo(r.davidTenPercent, 10);
  });

  it("extras altíssimos não fazem o David receber menos que o piso", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 5000,
    });
    expect(r.extraTableValue).toBeLessThan(0);
    expect(r.totalDavid).toBe(100);
  });
});

describe("computeRental — casos de borda", () => {
  it("valor recebido zero devolve tudo zerado do lado do David", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 0,
      cleaningFee: 0,
      extrasTotal: 0,
    });
    expect(r.davidTenPercent).toBe(0);
    expect(r.totalDavid).toBe(0);
    expect(r.netForDistribution).toBe(0);
  });

  it("estadia sem noites tem valor de tabela zero e nenhuma noite detalhada", () => {
    const r = computeRental({
      checkIn,
      checkOut: checkIn,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    expect(r.nights).toBe(0);
    expect(r.tableValue).toBe(0);
    expect(r.nightRates).toEqual([]);
    expect(r.extraTableValue).toBe(720);
    expect(r.totalDavid).toBe(460);
  });

  it("limpeza zero aumenta o extra de tabela e o total do David", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 0,
      extrasTotal: 0,
    });
    expect(r.extraTableValue).toBe(480);
    expect(r.totalDavid).toBe(340);
    expect(r.netForDistribution).toBe(660);
  });
});

describe("computeRental — diárias customizadas", () => {
  it("uma diária customizada muda o valor de tabela e o repasse", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
      nightRateOverrides: { "2026-06-09": 240 },
    });
    // 140 + 240 + 140
    expect(r.tableValue).toBe(520);
    expect(r.extraTableValue).toBe(200);
    expect(r.totalDavid).toBe(200);
    expect(r.hasCustomNightRates).toBe(true);
  });

  it("hasCustomNightRates é false quando nenhuma noite foi customizada", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
    });
    expect(r.hasCustomNightRates).toBe(false);
  });

  it("hasCustomNightRates é false quando o override não pertence ao período", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
      nightRateOverrides: { "2030-01-01": 999 },
    });
    expect(r.hasCustomNightRates).toBe(false);
    expect(r.tableValue).toBe(TABELA);
  });

  it("o detalhamento por noite acompanha o resultado", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
      nightRateOverrides: { "2026-06-09": 240 },
    });
    expect(r.nightRates).toHaveLength(3);
    expect(r.nightRates.map((n) => n.rate)).toEqual([140, 240, 140]);
    // A soma do detalhamento é exatamente o tableValue devolvido.
    expect(r.nightRates.reduce((s, n) => s + n.rate, 0)).toBe(r.tableValue);
  });

  it("aceita overrides null (registro criado antes da feature)", () => {
    const r = computeRental({
      checkIn,
      checkOut,
      netAmountReceived: 1000,
      cleaningFee: 180,
      extrasTotal: 0,
      nightRateOverrides: null,
    });
    expect(r.tableValue).toBe(TABELA);
    expect(r.hasCustomNightRates).toBe(false);
  });
});
