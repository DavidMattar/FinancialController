import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `prices.ts` guarda um cache em memória no escopo do MÓDULO, então cada teste
 * precisa de uma instância nova do módulo — senão o cache do teste anterior
 * responde no lugar do `fetch`. Daí o `vi.resetModules()` + `import()`
 * dinâmico em vez de um import estático no topo.
 */
async function carregarModulo() {
  vi.resetModules();
  return import("@/lib/prices");
}

/** Resposta de `fetch` fingida, com o `ok`/`status`/`json` que o módulo usa. */
function respostaOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function respostaErro(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("getCryptoPrices", () => {
  it("devolve objeto vazio sem chamar a API quando a lista está vazia", async () => {
    const { getCryptoPrices } = await carregarModulo();
    await expect(getCryptoPrices([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mapeia a resposta do CoinGecko para o formato do app", async () => {
    fetchMock.mockResolvedValue(
      respostaOk({
        bitcoin: { brl: 350000, usd: 65000, brl_24h_change: 1.25 },
        ethereum: { brl: 18000, usd: 3400, brl_24h_change: -0.5 },
      }),
    );
    const { getCryptoPrices } = await carregarModulo();
    await expect(getCryptoPrices(["bitcoin", "ethereum"])).resolves.toEqual({
      bitcoin: { id: "bitcoin", brl: 350000, usd: 65000, brl24hChange: 1.25 },
      ethereum: { id: "ethereum", brl: 18000, usd: 3400, brl24hChange: -0.5 },
    });
  });

  it("omite as moedas que a API não devolveu", async () => {
    fetchMock.mockResolvedValue(respostaOk({ bitcoin: { brl: 1, usd: 2 } }));
    const { getCryptoPrices } = await carregarModulo();
    const r = await getCryptoPrices(["bitcoin", "moeda-inexistente"]);
    expect(Object.keys(r)).toEqual(["bitcoin"]);
  });

  it("aceita resposta sem variação de 24h", async () => {
    fetchMock.mockResolvedValue(respostaOk({ bitcoin: { brl: 1, usd: 2 } }));
    const { getCryptoPrices } = await carregarModulo();
    const r = await getCryptoPrices(["bitcoin"]);
    expect(r.bitcoin.brl24hChange).toBeUndefined();
  });

  it("monta a URL com os ids e as moedas pedidas", async () => {
    fetchMock.mockResolvedValue(respostaOk({}));
    const { getCryptoPrices } = await carregarModulo();
    await getCryptoPrices(["bitcoin", "the-open-network"]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("api.coingecko.com/api/v3/simple/price");
    expect(url).toContain("ids=bitcoin%2Cthe-open-network");
    expect(url).toContain("vs_currencies=brl,usd");
    expect(url).toContain("include_24hr_change=true");
    expect(options).toEqual({ headers: { Accept: "application/json" } });
  });

  it("propaga erro quando a API responde falha", async () => {
    fetchMock.mockResolvedValue(respostaErro(429));
    const { getCryptoPrices } = await carregarModulo();
    await expect(getCryptoPrices(["bitcoin"])).rejects.toThrow("CoinGecko error: 429");
  });

  it("não guarda no cache uma chamada que falhou", async () => {
    fetchMock.mockResolvedValueOnce(respostaErro(500));
    fetchMock.mockResolvedValueOnce(respostaOk({ bitcoin: { brl: 1, usd: 2 } }));
    const { getCryptoPrices } = await carregarModulo();
    await expect(getCryptoPrices(["bitcoin"])).rejects.toThrow();
    await expect(getCryptoPrices(["bitcoin"])).resolves.toHaveProperty("bitcoin");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getCryptoPrices — cache de 30s", () => {
  it("reaproveita o resultado dentro da janela de cache", async () => {
    fetchMock.mockResolvedValue(respostaOk({ bitcoin: { brl: 1, usd: 2 } }));
    const { getCryptoPrices } = await carregarModulo();
    await getCryptoPrices(["bitcoin"]);
    await getCryptoPrices(["bitcoin"]);
    await getCryptoPrices(["bitcoin"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a chave do cache ignora a ordem dos ids", async () => {
    fetchMock.mockResolvedValue(respostaOk({}));
    const { getCryptoPrices } = await carregarModulo();
    await getCryptoPrices(["bitcoin", "ethereum"]);
    await getCryptoPrices(["ethereum", "bitcoin"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("busca de novo depois de a janela de cache expirar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
    fetchMock.mockResolvedValue(respostaOk({ bitcoin: { brl: 1, usd: 2 } }));
    const { getCryptoPrices } = await carregarModulo();

    await getCryptoPrices(["bitcoin"]);
    // 29s depois: ainda vale o cache.
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 29));
    await getCryptoPrices(["bitcoin"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 31s depois: expirou.
    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 31));
    await getCryptoPrices(["bitcoin"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listas de ids diferentes têm caches independentes", async () => {
    fetchMock.mockResolvedValue(respostaOk({}));
    const { getCryptoPrices } = await carregarModulo();
    await getCryptoPrices(["bitcoin"]);
    await getCryptoPrices(["ethereum"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getCurrencyRatesInBrl", () => {
  it("devolve objeto vazio sem chamar a API quando a lista está vazia", async () => {
    const { getCurrencyRatesInBrl } = await carregarModulo();
    await expect(getCurrencyRatesInBrl([])).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("inverte a taxa: a API dá moeda por BRL, o app quer BRL por moeda", async () => {
    // A API diz que 1 BRL = 0,2 USD; logo 1 USD = 5 BRL.
    fetchMock.mockResolvedValue(respostaOk({ rates: { USD: 0.2, EUR: 0.16 } }));
    const { getCurrencyRatesInBrl } = await carregarModulo();
    const r = await getCurrencyRatesInBrl(["USD", "EUR"]);
    expect(r.USD).toBeCloseTo(5, 10);
    expect(r.EUR).toBeCloseTo(6.25, 10);
  });

  it("omite os códigos que a API não devolveu", async () => {
    fetchMock.mockResolvedValue(respostaOk({ rates: { USD: 0.2 } }));
    const { getCurrencyRatesInBrl } = await carregarModulo();
    const r = await getCurrencyRatesInBrl(["USD", "XXX"]);
    expect(Object.keys(r)).toEqual(["USD"]);
  });

  it("omite código cuja taxa é zero (evita divisão por zero)", async () => {
    fetchMock.mockResolvedValue(respostaOk({ rates: { USD: 0 } }));
    const { getCurrencyRatesInBrl } = await carregarModulo();
    await expect(getCurrencyRatesInBrl(["USD"])).resolves.toEqual({});
  });

  it("chama o endpoint de cotações com base em BRL", async () => {
    fetchMock.mockResolvedValue(respostaOk({ rates: {} }));
    const { getCurrencyRatesInBrl } = await carregarModulo();
    await getCurrencyRatesInBrl(["USD"]);
    expect(fetchMock).toHaveBeenCalledWith("https://open.er-api.com/v6/latest/BRL", {
      headers: { Accept: "application/json" },
    });
  });

  it("propaga erro quando a API responde falha", async () => {
    fetchMock.mockResolvedValue(respostaErro(503));
    const { getCurrencyRatesInBrl } = await carregarModulo();
    await expect(getCurrencyRatesInBrl(["USD"])).rejects.toThrow(
      "Exchange rate API error: 503",
    );
  });

  it("usa cache próprio, independente do cache de cripto", async () => {
    fetchMock.mockResolvedValue(respostaOk({ rates: { USD: 0.2 }, bitcoin: { brl: 1, usd: 2 } }));
    const { getCurrencyRatesInBrl, getCryptoPrices } = await carregarModulo();
    await getCurrencyRatesInBrl(["USD"]);
    await getCurrencyRatesInBrl(["USD"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Cripto tem chave de cache diferente, então busca de novo.
    await getCryptoPrices(["bitcoin"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
