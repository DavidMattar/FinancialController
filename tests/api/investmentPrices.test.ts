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

/**
 * Uma compra como o Prisma devolve (Decimal serializado como string).
 * A rota não recebe mais quantidade/custo médio prontos: eles são a soma das
 * compras (ver src/lib/investments.ts), então é a lista de compras que define
 * a posição em cada teste.
 */
function compra(over: Record<string, unknown> = {}) {
  return {
    id: "buy-1",
    holdingId: "hold-1",
    quantity: "0.5",
    unitCostBrl: "200000",
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    updatedAt: new Date("2026-08-20T12:00:00.000Z"),
    ...over,
  };
}

/** Posição como o Prisma devolve, já com `include: { purchases }`. */
function posicao(over: Record<string, unknown> = {}) {
  return {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    notes: null,
    purchases: [compra()],
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
      currentValue: 150000,
      gainLoss: 50000,
      gainLossPercent: 50,
    });
  });

  it("devolve a variação da cotação em relação ao custo médio", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({
      bitcoin: { id: "bitcoin", brl: 300000, usd: 55000, brl24hChange: 2.5 },
    });

    const { body } = await readJson(await GET());

    // Pagou 200.000 por unidade, cotação em 300.000: +100.000 por unidade (+50%).
    expect(body.holdings[0].priceVsCost).toBe(100000);
    expect(body.holdings[0].priceVsCostPercent).toBe(50);
    expect(body.holdings[0]).not.toHaveProperty("change24h");
  });

  it("devolve variação negativa quando a cotação está abaixo do preço pago", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 150000, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0].priceVsCost).toBe(-50000);
    expect(body.holdings[0].priceVsCostPercent).toBe(-25);
  });

  it("devolve a descrição do ativo escrita pelo usuário", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao({ notes: "aporte da reserva" })]);

    const { body } = await readJson(await GET());

    expect(body.holdings[0].notes).toBe("aporte da reserva");
  });

  it("traduz o símbolo para o id do CoinGecko na consulta", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao({ symbol: "MATIC" })]);

    await GET();

    expect(cripto).toHaveBeenCalledWith(["matic-network"]);
  });

  it("calcula uma posição em moeda estrangeira pela taxa de câmbio", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({
        id: "hold-2",
        type: "CURRENCY",
        symbol: "USD",
        purchases: [compra({ quantity: "100", unitCostBrl: "5" })],
      }),
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
    // Moeda estrangeira também ganha a comparação com o preço pago: comprou
    // o dólar a R$ 5,00 e a cotação está em R$ 5,50.
    expect(body.holdings[0].priceVsCost).toBe(0.5);
    expect(body.holdings[0].priceVsCostPercent).toBe(10);
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
      priceVsCost: null,
      priceVsCostPercent: null,
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
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({ purchases: [compra({ unitCostBrl: "0" })] }),
    ]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300000, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0].cost).toBe(0);
    expect(body.holdings[0].gainLoss).toBe(150000);
    expect(body.holdings[0].gainLossPercent).toBeNull();
    expect(body.totals.totalGainLossPercent).toBe(0);
    // Sem preço de compra não existe "quanto subiu em relação ao que pagou":
    // o valor absoluto ainda faz sentido, o percentual não.
    expect(body.holdings[0].priceVsCost).toBe(300000);
    expect(body.holdings[0].priceVsCostPercent).toBeNull();
  });

  it("soma os totais de todas as posições", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao(),
      posicao({
        id: "hold-2",
        type: "CURRENCY",
        symbol: "USD",
        purchases: [compra({ quantity: "100", unitCostBrl: "5" })],
      }),
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

  it("busca as compras de cada posição, na ordem em que foram registradas", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([]);

    await GET();

    expect(prisma.investmentHolding.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      include: { purchases: { orderBy: { createdAt: "asc" } } },
    });
  });
});

describe("GET /api/investments/prices — compra por compra", () => {
  it("deriva quantidade e custo médio da soma das compras", async () => {
    // 3 unidades a R$100 + 1 a R$200 = 4 unidades, custo R$500, médio R$125
    // (ponderado pela quantidade, não média simples dos preços).
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({
        purchases: [
          compra({ id: "buy-1", quantity: "3", unitCostBrl: "100" }),
          compra({ id: "buy-2", quantity: "1", unitCostBrl: "200" }),
        ],
      }),
    ]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0]).toMatchObject({ quantity: 4, cost: 500, avgCostBrl: 125 });
  });

  it("devolve o resultado de cada compra separadamente", async () => {
    // Mesma cotação para as duas, preços pagos diferentes: é exatamente o que a
    // visão compactada (que mostra só o custo médio) esconde.
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({
        purchases: [
          compra({ id: "buy-barata", quantity: "1", unitCostBrl: "100" }),
          compra({ id: "buy-cara", quantity: "1", unitCostBrl: "400" }),
        ],
      }),
    ]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300, usd: 1 } });

    const { body } = await readJson(await GET());

    const [barata, cara] = body.holdings[0].purchases;
    expect(barata).toMatchObject({ id: "buy-barata", cost: 100, currentValue: 300, gainLoss: 200, gainLossPercent: 200 });
    expect(cara).toMatchObject({ id: "buy-cara", cost: 400, currentValue: 300, gainLoss: -100, gainLossPercent: -25 });
  });

  it("a soma dos lucros das compras é o lucro da posição", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      posicao({
        purchases: [
          compra({ id: "buy-1", quantity: "1", unitCostBrl: "100" }),
          compra({ id: "buy-2", quantity: "2", unitCostBrl: "400" }),
        ],
      }),
    ]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300, usd: 1 } });

    const { body } = await readJson(await GET());

    const soma = body.holdings[0].purchases.reduce(
      (total: number, p: { gainLoss: number }) => total + p.gainLoss,
      0,
    );
    expect(soma).toBeCloseTo(body.holdings[0].gainLoss, 8);
  });

  it("sem cotação, cada compra sai com valor atual e lucro nulos mas com o custo", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);
    cripto.mockResolvedValue({});

    const { body } = await readJson(await GET());

    expect(body.holdings[0].purchases[0]).toMatchObject({
      cost: 100000,
      currentValue: null,
      gainLoss: null,
      gainLossPercent: null,
    });
  });

  it("posição sem compra nenhuma sai zerada, sem NaN", async () => {
    // Só acontece com dado inconsistente (a API nunca cria posição sem compra),
    // mas uma divisão por zero aqui contaminaria a carteira inteira.
    prisma.investmentHolding.findMany.mockResolvedValue([posicao({ purchases: [] })]);
    cripto.mockResolvedValue({ bitcoin: { id: "bitcoin", brl: 300000, usd: 1 } });

    const { body } = await readJson(await GET());

    expect(body.holdings[0]).toMatchObject({ quantity: 0, cost: 0, avgCostBrl: 0, purchases: [] });
    expect(body.totals.totalGainLoss).toBe(0);
  });

  it("devolve a data de cada compra em ISO", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([posicao()]);

    const { body } = await readJson(await GET());

    expect(body.holdings[0].purchases[0].createdAt).toBe("2026-08-20T12:00:00.000Z");
  });
});
