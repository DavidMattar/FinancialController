import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));
vi.mock("@/lib/prices", () => ({
  getCryptoPrices: vi.fn(),
  getCurrencyRatesInBrl: vi.fn(),
}));

import { GET } from "@/app/api/investments/prices/route";
import { getCryptoPrices, getCurrencyRatesInBrl } from "@/lib/prices";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { readJson } from "../helpers/http";

const cripto = vi.mocked(getCryptoPrices);
const cambio = vi.mocked(getCurrencyRatesInBrl);

beforeEach(() => {
  resetPrismaMock();
  cripto.mockReset();
  cambio.mockReset();
  cripto.mockResolvedValue({});
  cambio.mockResolvedValue({});
});

/** Posição como o Prisma devolve (Decimal serializado como string). */
function posicao(over: Record<string, unknown> = {}) {
  return {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    quantity: "0.5",
    avgCostBrl: "200000",
    ...over,
  };
}

describe("GET /api/investments/prices", () => {
  it("calcula valor de mercado, lucro e percentual de uma cripto", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({
      bitcoin: { id: "bitcoin", brl: 300000, usd: 55000, brl24hChange: 2.5 },
    });

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body.holdings[0]).toMatchObject({
      symbol: "BTC",
      quantity: 0.5,
      avgCostBrl: 200000,
      cost: 100000,
      priceBrl: 300000,
      change24h: 2.5,
      currentValue: 150000,
      gainLoss: 50000,
      gainLossPercent: 50,
    });
  });

  it("traduz o símbolo para o id do CoinGecko na consulta", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao({ symbol: "MATIC" })]);

    await GET();

    expect(cripto).toHaveBeenCalledWith(["matic-network"]);
  });

  it("calcula uma posição em moeda estrangeira pela taxa de câmbio", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({ id: "hold-2", type: "CURRENCY", symbol: "USD", quantity: "100", avgCostBrl: "5" }),
    ]);
    cambio.mockResolvedValue({ USD: 5.5 });

    const { body } = await readJson(await GET());

    expect(body.holdings[0]).toMatchObject({
      cost: 500,
      priceBrl: 5.5,
      currentValue: 550,
      gainLoss: 50,
      gainLossPercent: 10,
    });
    // Moeda não tem variação de 24h nesta fonte.
    expect(body.holdings[0].change24h).toBeNull();
  });

  it("consulta o código da moeda em maiúsculo", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({ type: "CURRENCY", symbol: "usd" }),
    ]);

    await GET();

    expect(cambio).toHaveBeenCalledWith(["USD"]);
  });

  it("devolve preço nulo quando a cotação da cripto não veio", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({});

    const { body } = await readJson(await GET());

    expect(body.holdings[0]).toMatchObject({
      priceBrl: null,
      change24h: null,
      currentValue: null,
      gainLoss: null,
      gainLossPercent: null,
    });
    // O custo continua sendo contabilizado.
    expect(body.totals.totalCost).toBe(100000);
    expect(body.totals.totalCurrentValue).toBe(0);
  });

  it("devolve preço nulo quando a cotação da moeda não veio", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({ type: "CURRENCY", symbol: "EUR" }),
    ]);
    cambio.mockResolvedValue({});

    const { body } = await readJson(await GET());

    expect(body.holdings[0].priceBrl).toBeNull();
  });

  it("não derruba a rota quando a API de cripto falha", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockRejectedValue(new Error("sem internet"));

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body.holdings[0].priceBrl).toBeNull();
  });

  it("não derruba a rota quando a API de câmbio falha", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({ type: "CURRENCY", symbol: "USD" }),
    ]);
    cambio.mockRejectedValue(new Error("sem internet"));

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body.holdings[0].priceBrl).toBeNull();
  });

  it("não calcula percentual quando o custo é zero (evita divisão por zero)", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao({ avgCostBrl: "0" })]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300000, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0].cost).toBe(0);
    expect(body.holdings[0].gainLoss).toBe(150000);
    expect(body.holdings[0].gainLossPercent).toBeNull();
    expect(body.totals.totalGainLossPercent).toBe(0);
  });

  it("soma os totais de todas as posições", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao(),
      posicao({ id: "hold-2", type: "CURRENCY", symbol: "USD", quantity: "100", avgCostBrl: "5" }),
    ]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300000, usd: 1 } });
    cambio.mockResolvedValue({ USD: 5.5 });

    const { body } = await readJson(await GET());

    expect(body.totals.totalCost).toBe(100500);
    expect(body.totals.totalCurrentValue).toBe(150550);
    expect(body.totals.totalGainLoss).toBe(50050);
    expect(body.totals.totalGainLossPercent).toBeCloseTo((50050 / 100500) * 100, 8);
  });

  it("aceita prejuízo (valor de mercado abaixo do custo)", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 100000, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0].gainLoss).toBe(-50000);
    expect(body.holdings[0].gainLossPercent).toBe(-50);
    expect(body.totals.totalGainLoss).toBe(-50000);
  });

  it("devolve tudo zerado quando não há posição cadastrada", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([]);

    const { body } = await readJson(await GET());

    expect(body.holdings).toEqual([]);
    expect(body.totals).toEqual({
      totalCost: 0,
      totalCurrentValue: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
    });
  });

  it("não chama as APIs externas quando não há posição do tipo", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    await GET();
    expect(cripto).toHaveBeenCalledWith(["bitcoin"]);
    // Sem posição em moeda, a lista de códigos vai vazia (a lib nem chama a rede).
    expect(cambio).toHaveBeenCalledWith([]);
  });

  it("informa o instante da consulta", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([]);
    const { body } = await readJson(await GET());
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
  });
});
