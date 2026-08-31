interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

// Tempo (em milissegundos) que um preço buscado fica "válido" antes de ser
// buscado de novo. Evita chamar as APIs externas (CoinGecko, exchange rate) a
// cada re-render da tela — se o usuário atualizar a página várias vezes em
// menos de 30s, reaproveita o valor já buscado.
const CACHE_TTL_MS = 30_000;
// Cache simples em memória do processo Node. Some quando o servidor reinicia
// (não é persistido em banco), o que é aceitável pois é só um cache de curto prazo.
const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Executa `fetcher` e guarda o resultado em cache por `CACHE_TTL_MS`
 * milissegundos, associado à `key` informada. Chamadas repetidas com a mesma
 * `key` dentro desse período retornam o valor já buscado, sem chamar `fetcher`
 * de novo.
 */
async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.value as T;
  }
  const value = await fetcher();
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

/** Cotação de uma criptomoeda num determinado instante. */
export interface CryptoPrice {
  /** Id da moeda no CoinGecko (ex: "bitcoin"), não o símbolo (ex: "BTC"). */
  id: string;
  /** Preço em reais. */
  brl: number;
  /** Preço em dólares americanos. */
  usd: number;
  /**
   * Variação percentual do preço em reais nas últimas 24h, se disponível.
   *
   * Faz parte da cotação que o CoinGecko devolve, mas hoje NENHUMA tela usa:
   * a coluna de variação da página de investimentos passou a comparar a
   * cotação atual com o custo médio pago (ver /api/investments/prices), que é
   * o que diz como a posição está indo. Continua aqui porque descreve o
   * payload da fonte externa, não a necessidade de uma tela específica.
   */
  brl24hChange?: number;
}

/**
 * Busca o preço atual (em BRL e USD) de uma lista de criptomoedas na API
 * pública do CoinGecko. Os `ids` devem ser ids do CoinGecko (ex: "bitcoin",
 * "ethereum"), não os símbolos das moedas — ver `cryptoIds.ts` para a conversão.
 *
 * @returns Um objeto onde a chave é o id da moeda e o valor é a cotação
 *   encontrada. Moedas não encontradas na resposta da API simplesmente não
 *   aparecem no resultado.
 */
export async function getCryptoPrices(ids: string[]): Promise<Record<string, CryptoPrice>> {
  if (ids.length === 0) return {};
  const key = `crypto:${ids.slice().sort().join(",")}`;
  return cached(key, async () => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      ids.join(","),
    )}&vs_currencies=brl,usd&include_24hr_change=true`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
    const data = await res.json();
    const result: Record<string, CryptoPrice> = {};
    for (const id of ids) {
      const entry = data[id];
      if (!entry) continue;
      result[id] = {
        id,
        brl: entry.brl,
        usd: entry.usd,
        brl24hChange: entry.brl_24h_change,
      };
    }
    return result;
  });
}

/**
 * Busca a cotação de moedas estrangeiras (ex: "USD", "EUR") em reais, usando
 * a API pública open.er-api.com. A API retorna quantas unidades de cada
 * moeda equivalem a 1 BRL; esta função inverte a conta (`1 / taxa`) para
 * retornar quantos reais valem 1 unidade da moeda, que é mais intuitivo de
 * usar no resto do app (ex: para multiplicar por um valor em dólar).
 *
 * @param codes - Códigos de moeda ISO (ex: ["USD", "EUR"]).
 * @returns Objeto onde a chave é o código da moeda e o valor é quantos reais
 *   equivalem a 1 unidade dela. Códigos não encontrados na resposta ficam de fora.
 */
export async function getCurrencyRatesInBrl(codes: string[]): Promise<Record<string, number>> {
  if (codes.length === 0) return {};
  const key = `fx:${codes.slice().sort().join(",")}`;
  return cached(key, async () => {
    const res = await fetch("https://open.er-api.com/v6/latest/BRL", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Exchange rate API error: ${res.status}`);
    const data = await res.json();
    const rates = data.rates as Record<string, number>;
    const result: Record<string, number> = {};
    for (const code of codes) {
      const rateBrlToCode = rates[code];
      if (rateBrlToCode) result[code] = 1 / rateBrlToCode;
    }
    return result;
  });
}
