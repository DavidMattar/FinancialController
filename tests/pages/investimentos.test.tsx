import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvestimentosPage from "@/app/investimentos/page";
import { normalizarEspacos as norm } from "../helpers/text";
import { campoPorRotulo } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;

function ativo(over: Record<string, unknown> = {}) {
  return {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    quantity: 0.5,
    avgCostBrl: 200000,
    cost: 100000,
    priceBrl: 300000,
    change24h: 2.5,
    currentValue: 150000,
    gainLoss: 50000,
    gainLossPercent: 50,
    ...over,
  };
}

function resposta(holdings: unknown[], totais: Record<string, number> = {}) {
  return {
    holdings,
    totals: {
      totalCost: 100000,
      totalCurrentValue: 150000,
      totalGainLoss: 50000,
      totalGainLossPercent: 50,
      ...totais,
    },
    fetchedAt: "2026-08-15T15:04:05.000Z",
  };
}

function comAtivos(...respostas: ReturnType<typeof resposta>[]) {
  const fila = [...respostas];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
    const proxima = fila.length > 1 ? fila.shift()! : fila[0];
    return { json: async () => proxima };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("página /investimentos — carteira", () => {
  it("informa a origem das cotações e a frequência de atualização", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    expect(screen.getByText(/CoinGecko \/ open\.er-api\.com/)).toBeInTheDocument();
    expect(screen.getByText(/atualiza a cada 30s/)).toBeInTheDocument();
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<InvestimentosPage />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("busca os preços na rota de cotação ao vivo", async () => {
    comAtivos(resposta([]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/investments/prices"));
  });

  it("mostra o horário da última atualização", async () => {
    comAtivos(resposta([]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText(/última atualização/)).toBeInTheDocument());
  });

  it("mostra os três totais da carteira", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("Custo total investido")).toBeInTheDocument());
    // "Valor atual" e "Resultado" aparecem também no cabeçalho da tabela,
    // então a busca é escopada no bloco dos cards de total.
    const cards = screen.getByText("Custo total investido").closest("div")!.parentElement!;
    expect(cards.textContent).toContain("Valor atual");
    expect(cards.textContent).toContain("Resultado");
    const texto = norm(document.body.textContent);
    expect(texto).toContain(norm("R$ 100.000,00"));
    expect(texto).toContain(norm("R$ 150.000,00"));
    expect(texto).toContain(norm("R$ 50.000,00 (50.0%)"));
  });

  it("mostra o resultado total negativo em vermelho", async () => {
    comAtivos(
      resposta([ativo({ gainLoss: -20000, gainLossPercent: -20 })], {
        totalGainLoss: -20000,
        totalGainLossPercent: -20,
      }),
    );

    render(<InvestimentosPage />);

    // O mesmo percentual aparece no card de total e na linha do ativo; o
    // primeiro é o card da carteira.
    await waitFor(() => expect(screen.getAllByText(/-20\.0%/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/-20\.0%/)[0].className).toContain("text-red-600");
  });

  it("lista o ativo com símbolo, nome, quantidade e valores", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    expect(screen.getByText("Bitcoin")).toBeInTheDocument();
    expect(screen.getByText("0.5")).toBeInTheDocument();
    expect(screen.getByText("2.50%")).toBeInTheDocument();
    const linha = screen.getByText("BTC").closest("tr")!;
    expect(norm(linha.textContent)).toContain(norm("R$ 300.000,00"));
    expect(norm(linha.textContent)).toContain(norm("R$ 50.000,00 (50.0%)"));
  });

  it("mostra travessão quando a cotação não veio", async () => {
    comAtivos(
      resposta([
        ativo({ priceBrl: null, change24h: null, currentValue: null, gainLoss: null, gainLossPercent: null }),
      ]),
    );

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    const linha = screen.getByText("BTC").closest("tr")!;
    expect(linha.textContent).toContain("—");
  });

  it("colore a variação de 24h negativa em vermelho", async () => {
    comAtivos(resposta([ativo({ change24h: -3.75 })]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("-3.75%")).toBeInTheDocument());
    expect(screen.getByText("-3.75%").className).toContain("text-red-600");
  });

  it("colore o resultado negativo do ativo em vermelho", async () => {
    comAtivos(resposta([ativo({ gainLoss: -1000, gainLossPercent: -10 })]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText(/-10\.0%/)).toBeInTheDocument());
    expect(screen.getByText(/-10\.0%/).className).toContain("text-red-600");
  });

  it("atualiza as cotações automaticamente a cada 30s", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("para de atualizar depois de sair da página", async () => {
    comAtivos(resposta([ativo()]));

    const { unmount } = render(<InvestimentosPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mostra a carteira vazia sem quebrar", async () => {
    comAtivos(resposta([], { totalCost: 0, totalCurrentValue: 0, totalGainLoss: 0, totalGainLossPercent: 0 }));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("Custo total investido")).toBeInTheDocument());
    expect(screen.queryByText("BTC")).not.toBeInTheDocument();
  });
});

describe("página /investimentos — exclusão", () => {
  it("pede confirmação e remove o ativo", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(window.confirm).toHaveBeenCalledWith("Remover este ativo?");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/investments/hold-1", { method: "DELETE" }),
    );
  });

  it("cancelar a confirmação não remove nada", async () => {
    comAtivos(resposta([ativo()]));
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });

  it("recarrega a lista depois de remover", async () => {
    comAtivos(
      resposta([ativo()]),
      resposta([], { totalCost: 0, totalCurrentValue: 0, totalGainLoss: 0, totalGainLossPercent: 0 }),
    );

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    await waitFor(() => expect(screen.queryByText("BTC")).not.toBeInTheDocument());
  });
});

describe("página /investimentos — novo ativo", () => {
  async function abrirFormulario() {
    comAtivos(resposta([]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Novo ativo" }));
  }

  it("abre e fecha pelo mesmo botão", async () => {
    await abrirFormulario();
    expect(screen.getByRole("button", { name: "Adicionar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Adicionar" })).not.toBeInTheDocument();
  });

  it("cria o ativo com símbolo em caixa alta", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "0,5" } });
    fireEvent.change(campoPorRotulo("Preço médio"), { target: { value: "200000" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "CRYPTO",
          symbol: "BTC",
          name: "BTC",
          quantity: 0.5,
          avgCostBrl: 200000,
        }),
      }),
    );
  });

  it("usa o nome informado quando existe", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "eth" } });
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "Ethereum" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "2" } });
    fireEvent.change(campoPorRotulo("Preço médio"), { target: { value: "10000" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).name).toBe("Ethereum");
    });
  });

  it("permite cadastrar moeda estrangeira", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Tipo"), { target: { value: "CURRENCY" } });
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "usd" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "100" } });
    fireEvent.change(campoPorRotulo("Preço médio"), { target: { value: "5,25" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      const corpo = JSON.parse(post![1].body);
      expect(corpo.type).toBe("CURRENCY");
      expect(corpo.symbol).toBe("USD");
      expect(corpo.avgCostBrl).toBe(5.25);
    });
  });

  it("fecha o formulário e recarrega depois de criar", async () => {
    comAtivos(
      resposta([], { totalCost: 0, totalCurrentValue: 0, totalGainLoss: 0, totalGainLossPercent: 0 }),
      resposta([ativo()]),
    );
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Novo ativo" }));

    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço médio"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Adicionar" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
  });

  it("desabilita o botão enquanto envia", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
        return { ok: true, json: async () => ({}) };
      }
      return { json: async () => resposta([]) };
    });

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Novo ativo" }));
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço médio"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar" })).toBeDisabled());
    liberar();
  });
});
