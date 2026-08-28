// Mapa de símbolo de criptomoeda (como o usuário digita/vê, ex: "BTC") para o
// id usado pela API do CoinGecko (ex: "bitcoin"). É necessário porque o
// CoinGecko não aceita o símbolo diretamente na maioria dos seus endpoints —
// ele exige o id interno dele, que geralmente é o nome da moeda em minúsculo,
// mas nem sempre (ex: "MATIC" -> "matic-network", não "matic").
export const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  TRX: "tron",
  TON: "the-open-network",
  DOT: "polkadot",
  MATIC: "matic-network",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  SHIB: "shiba-inu",
  LINK: "chainlink",
};

/**
 * Converte o símbolo de uma criptomoeda (ex: "BTC") para o id que a API do
 * CoinGecko espera (ex: "bitcoin"), usando o mapa `SYMBOL_TO_COINGECKO_ID`.
 *
 * @param symbol - Símbolo da moeda, em qualquer caixa (ex: "btc" ou "BTC").
 * @returns O id do CoinGecko correspondente. Se o símbolo não estiver no
 *   mapa (moeda não prevista na lista), usa o próprio símbolo em minúsculo
 *   como tentativa — funciona para muitas moedas cujo id é igual ao nome.
 */
export function toCoingeckoId(symbol: string): string {
  return SYMBOL_TO_COINGECKO_ID[symbol.toUpperCase()] ?? symbol.toLowerCase();
}
