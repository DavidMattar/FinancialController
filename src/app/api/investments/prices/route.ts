import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCryptoPrices, getCurrencyRatesInBrl, type CryptoPrice } from "@/lib/prices";
import { toCoingeckoId } from "@/lib/cryptoIds";

/**
 * GET /api/investments/prices
 * Busca a cotação atual de cada posição de investimento e calcula o valor de mercado,
 * lucro/perda absoluto e percentual — tudo recalculado do zero a cada chamada, nunca
 * armazenado no banco (o preço de cripto/moeda muda a cada segundo).
 *
 * Esta é a ÚNICA rota do sistema que faz chamadas para serviços externos na internet:
 * - CoinGecko (api.coingecko.com) para preço de criptomoedas em BRL, sem necessidade de API key.
 * - open.er-api.com para taxas de câmbio de moedas estrangeiras em BRL, também sem API key.
 * O app é local-first (Postgres local, sem nuvem) e essas duas são a exceção deliberada,
 * pois cotações de mercado não podem ser calculadas localmente.
 * Se qualquer uma das chamadas falhar (ex: sem internet), o `.catch` faz o preço daquele
 * tipo de ativo cair para "desconhecido" (null) em vez de derrubar a rota inteira.
 */
export async function GET() {
  const holdings = await prisma.investmentHolding.findMany({ orderBy: { createdAt: "asc" } });

  const cryptoHoldings = holdings.filter((h) => h.type === "CRYPTO");
  const currencyHoldings = holdings.filter((h) => h.type === "CURRENCY");

  const cryptoIds = cryptoHoldings.map((h) => toCoingeckoId(h.symbol));
  const currencyCodes = currencyHoldings.map((h) => h.symbol.toUpperCase());

  const [cryptoPrices, currencyRates] = await Promise.all([
    getCryptoPrices(cryptoIds).catch(() => ({}) as Record<string, CryptoPrice>),
    getCurrencyRatesInBrl(currencyCodes).catch(() => ({}) as Record<string, number>),
  ]);

  let totalCurrentValue = 0;
  let totalCost = 0;

  const result = holdings.map((h) => {
    const quantity = Number(h.quantity);
    const avgCostBrl = Number(h.avgCostBrl);
    const cost = quantity * avgCostBrl;

    let priceBrl: number | null = null;
    let change24h: number | null = null;
    if (h.type === "CRYPTO") {
      const price = cryptoPrices[toCoingeckoId(h.symbol)];
      priceBrl = price?.brl ?? null;
      change24h = price?.brl24hChange ?? null;
    } else {
      priceBrl = currencyRates[h.symbol.toUpperCase()] ?? null;
    }

    const currentValue = priceBrl !== null ? quantity * priceBrl : null;
    const gainLoss = currentValue !== null ? currentValue - cost : null;
    const gainLossPercent = currentValue !== null && cost > 0 ? (gainLoss! / cost) * 100 : null;

    if (currentValue !== null) totalCurrentValue += currentValue;
    totalCost += cost;

    return {
      id: h.id,
      type: h.type,
      symbol: h.symbol,
      name: h.name,
      quantity,
      avgCostBrl,
      cost,
      priceBrl,
      change24h,
      currentValue,
      gainLoss,
      gainLossPercent,
    };
  });

  return NextResponse.json({
    holdings: result,
    totals: {
      totalCost,
      totalCurrentValue,
      totalGainLoss: totalCurrentValue - totalCost,
      totalGainLossPercent: totalCost > 0 ? ((totalCurrentValue - totalCost) / totalCost) * 100 : 0,
    },
    fetchedAt: new Date().toISOString(),
  });
}
