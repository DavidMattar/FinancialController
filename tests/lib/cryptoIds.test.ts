import { describe, expect, it } from "vitest";
import { SYMBOL_TO_COINGECKO_ID, toCoingeckoId } from "@/lib/cryptoIds";

describe("toCoingeckoId", () => {
  it("traduz os símbolos conhecidos para o id do CoinGecko", () => {
    expect(toCoingeckoId("BTC")).toBe("bitcoin");
    expect(toCoingeckoId("ETH")).toBe("ethereum");
    expect(toCoingeckoId("USDT")).toBe("tether");
  });

  it("traduz os casos em que o id NÃO é o nome óbvio (o motivo do mapa existir)", () => {
    expect(toCoingeckoId("MATIC")).toBe("matic-network");
    expect(toCoingeckoId("AVAX")).toBe("avalanche-2");
    expect(toCoingeckoId("TON")).toBe("the-open-network");
    expect(toCoingeckoId("BNB")).toBe("binancecoin");
    expect(toCoingeckoId("XRP")).toBe("ripple");
    expect(toCoingeckoId("SHIB")).toBe("shiba-inu");
    expect(toCoingeckoId("USDC")).toBe("usd-coin");
  });

  it("aceita o símbolo em minúsculo ou misturado", () => {
    expect(toCoingeckoId("btc")).toBe("bitcoin");
    expect(toCoingeckoId("Eth")).toBe("ethereum");
  });

  it("cai no símbolo em minúsculo quando a moeda não está no mapa", () => {
    expect(toCoingeckoId("XYZ")).toBe("xyz");
    expect(toCoingeckoId("Pepe")).toBe("pepe");
  });

  it("todos os símbolos do mapa traduzem para o id declarado", () => {
    for (const [symbol, id] of Object.entries(SYMBOL_TO_COINGECKO_ID)) {
      expect(toCoingeckoId(symbol)).toBe(id);
    }
  });
});
