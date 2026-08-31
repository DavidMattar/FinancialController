import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvestimentosPage from "@/app/investimentos/page";
import { normalizarEspacos as norm } from "../helpers/text";
import { campoPorRotulo } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;

/** Uma compra já com o resultado calculado, como a rota de preços devolve. */
function compra(over: Record<string, unknown> = {}) {
  return {
    id: "buy-1",
    createdAt: "2026-08-20T12:00:00.000Z",
    quantity: 0.5,
    unitCostBrl: 200000,
    cost: 100000,
    currentValue: 150000,
    gainLoss: 50000,
    gainLossPercent: 50,
    ...over,
  };
}

function ativo(over: Record<string, unknown> = {}) {
  return {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    notes: null,
    quantity: 0.5,
    avgCostBrl: 200000,
    cost: 100000,
    priceBrl: 300000,
    priceVsCost: 100000,
    priceVsCostPercent: 50,
    currentValue: 150000,
    gainLoss: 50000,
    gainLossPercent: 50,
    purchases: [compra()],
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

/** Abre (ou fecha) a lista de compras de um ativo clicando no símbolo. */
function expandir(simbolo = "BTC") {
  fireEvent.click(screen.getByRole("button", { name: `compras de ${simbolo}` }));
}

/** As chamadas de escrita (POST/PATCH/DELETE) que a tela disparou. */
function chamadas(method: string) {
  return fetchMock.mock.calls.filter((c) => c[1]?.method === method);
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
    const linha = screen.getByText("BTC").closest("tr")!;
    expect(norm(linha.textContent)).toContain(norm("R$ 300.000,00"));
    expect(norm(linha.textContent)).toContain(norm("R$ 50.000,00 (50.0%)"));
  });

  it("mostra travessão quando a cotação não veio", async () => {
    comAtivos(
      resposta([
        ativo({
          priceBrl: null,
          priceVsCost: null,
          priceVsCostPercent: null,
          currentValue: null,
          gainLoss: null,
          gainLossPercent: null,
        }),
      ]),
    );

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    const linha = screen.getByText("BTC").closest("tr")!;
    expect(linha.textContent).toContain("—");
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

describe("página /investimentos — coluna 'Vs. compra'", () => {
  // Esta coluna substituiu a variação de 24h: mostra quanto a cotação está
  // acima/abaixo do preço que o usuário pagou, por unidade do ativo.
  it("existe no cabeçalho, e a de 24h não existe mais", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("Vs. compra")).toBeInTheDocument());
    expect(screen.queryByText("24h")).not.toBeInTheDocument();
  });

  it("mostra a alta em percentual e em reais por unidade, com sinal", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("+50.00%")).toBeInTheDocument());
    expect(norm(screen.getByText(/\/un\./).textContent)).toBe(norm("+R$ 100.000,00 /un."));
  });

  it("colore a alta em verde e a queda em vermelho", async () => {
    comAtivos(resposta([ativo()]));

    const { unmount } = render(<InvestimentosPage />);
    await waitFor(() => expect(screen.getByText("+50.00%").closest("td")!.className).toContain("text-emerald-600"));
    unmount();

    comAtivos(resposta([ativo({ priceVsCost: -50000, priceVsCostPercent: -25 })]));
    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("-25.00%")).toBeInTheDocument());
    expect(screen.getByText("-25.00%").closest("td")!.className).toContain("text-red-600");
    expect(norm(screen.getByText(/\/un\./).textContent)).toBe(norm("-R$ 50.000,00 /un."));
  });

  it("mostra travessão no percentual quando o ativo não foi comprado (custo zero)", async () => {
    // Custo médio zero: o valor absoluto ainda faz sentido, o percentual não.
    comAtivos(resposta([ativo({ avgCostBrl: 0, priceVsCost: 300000, priceVsCostPercent: null })]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText(/\/un\./)).toBeInTheDocument());
    const celula = screen.getByText(/\/un\./).closest("td")!;
    expect(celula.textContent).toContain("—");
  });
});

describe("página /investimentos — compras de um ativo", () => {
  const doisAportes = ativo({
    quantity: 2,
    avgCostBrl: 250,
    cost: 500,
    priceBrl: 300,
    currentValue: 600,
    gainLoss: 100,
    gainLossPercent: 20,
    purchases: [
      compra({
        id: "buy-barata",
        createdAt: "2026-07-10T12:00:00.000Z",
        quantity: 1,
        unitCostBrl: 100,
        cost: 100,
        currentValue: 300,
        gainLoss: 200,
        gainLossPercent: 200,
      }),
      compra({
        id: "buy-cara",
        createdAt: "2026-08-05T12:00:00.000Z",
        quantity: 1,
        unitCostBrl: 400,
        cost: 400,
        currentValue: 300,
        gainLoss: -100,
        gainLossPercent: -25,
      }),
    ],
  });

  it("a linha compactada mostra o total e o lucro da posição inteira", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    const linha = screen.getByText("BTC").closest("tr")!;
    expect(norm(linha.textContent)).toContain(norm("R$ 500,00"));
    expect(norm(linha.textContent)).toContain(norm("R$ 100,00 (20.0%)"));
  });

  it("avisa quantas compras compõem a posição", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("2 compras")).toBeInTheDocument());
  });

  it("não mostra o contador quando há uma compra só", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    expect(screen.queryByText(/compras$/)).not.toBeInTheDocument();
  });

  it("as compras ficam escondidas até o usuário expandir", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("BTC")).toBeInTheDocument());
    expect(screen.queryByText(/resultado de cada aporte/)).not.toBeInTheDocument();
  });

  it("expande ao clicar no símbolo e mostra uma linha por compra", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();

    expect(screen.getByText(/resultado de cada aporte/)).toBeInTheDocument();
    // Uma linha por compra, com o preço pago em cada uma.
    expect(norm(document.body.textContent)).toContain(norm("R$ 100,00"));
    expect(norm(document.body.textContent)).toContain(norm("R$ 400,00"));
  });

  it("mostra o lucro de cada compra separadamente, na mesma cotação", async () => {
    // É esta a informação que a visão compactada esconde: a cotação é a mesma
    // para as duas, o preço pago em cada aporte não.
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();

    expect(screen.getByText(/\+200\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/-25\.00%/)).toBeInTheDocument();
  });

  it("colore o lucro de cada compra pelo sinal dela", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();

    expect(screen.getByText(/\+200\.00%/).className).toContain("text-emerald-600");
    expect(screen.getByText(/-25\.00%/).className).toContain("text-red-600");
  });

  it("mostra a data em que cada compra foi registrada", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();

    expect(screen.getByText("10/07/2026")).toBeInTheDocument();
    expect(screen.getByText("05/08/2026")).toBeInTheDocument();
  });

  it("fecha ao clicar no símbolo de novo", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();
    expect(screen.getByText(/resultado de cada aporte/)).toBeInTheDocument();

    expandir();
    expect(screen.queryByText(/resultado de cada aporte/)).not.toBeInTheDocument();
  });

  it("dá para deixar dois ativos expandidos ao mesmo tempo", async () => {
    comAtivos(resposta([doisAportes, ativo({ id: "hold-2", symbol: "ETH", name: "Ethereum" })]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir("BTC");
    expandir("ETH");

    expect(screen.getByText(/Compras de BTC/)).toBeInTheDocument();
    expect(screen.getByText(/Compras de ETH/)).toBeInTheDocument();
  });

  it("marca o estado de expansão no aria-expanded do botão", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expect(screen.getByRole("button", { name: "compras de BTC" })).toHaveAttribute("aria-expanded", "false");

    expandir();

    expect(screen.getByRole("button", { name: "compras de BTC" })).toHaveAttribute("aria-expanded", "true");
  });

  it("mostra travessão na compra quando a cotação não veio", async () => {
    comAtivos(
      resposta([
        ativo({
          priceBrl: null,
          priceVsCost: null,
          priceVsCostPercent: null,
          currentValue: null,
          gainLoss: null,
          gainLossPercent: null,
          purchases: [compra({ currentValue: null, gainLoss: null, gainLossPercent: null })],
        }),
      ]),
    );

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    expandir();

    const linhaDaCompra = screen.getByText("20/08/2026").closest("tr")!;
    expect(linhaDaCompra.textContent).toContain("—");
    // O custo é dado gravado: continua aparecendo mesmo sem cotação.
    expect(norm(linhaDaCompra.textContent)).toContain(norm("R$ 100.000,00"));
  });
});

describe("página /investimentos — apagar uma compra", () => {
  const doisAportes = ativo({
    purchases: [
      compra({ id: "buy-1" }),
      compra({ id: "buy-2", createdAt: "2026-08-25T12:00:00.000Z" }),
    ],
  });

  it("pede confirmação e apaga só aquela compra", async () => {
    comAtivos(resposta([doisAportes]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));
    expandir();

    fireEvent.click(screen.getByRole("button", { name: "apagar compra de 20/08/2026" }));

    expect(window.confirm).toHaveBeenCalledWith("Apagar esta compra?");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/investments/hold-1/purchases/buy-1", {
        method: "DELETE",
      }),
    );
  });

  it("avisa que apagar a única compra remove o ativo", async () => {
    // Sem esse aviso o usuário perderia o ativo sem saber por quê.
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));
    expandir();

    fireEvent.click(screen.getByRole("button", { name: "apagar compra de 20/08/2026" }));

    expect(window.confirm).toHaveBeenCalledWith(
      "Esta é a única compra de BTC — apagá-la remove o ativo da carteira. Continuar?",
    );
  });

  it("cancelar a confirmação não apaga nada", async () => {
    comAtivos(resposta([doisAportes]));
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));
    expandir();

    fireEvent.click(screen.getByRole("button", { name: "apagar compra de 20/08/2026" }));

    expect(chamadas("DELETE")).toHaveLength(0);
  });

  it("recarrega a carteira depois de apagar", async () => {
    comAtivos(resposta([doisAportes]), resposta([ativo()]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));
    expandir();

    fireEvent.click(screen.getByRole("button", { name: "apagar compra de 20/08/2026" }));

    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => !c[1]?.method)).toHaveLength(2));
  });
});

describe("página /investimentos — dicas de ajuda", () => {
  async function abrirFormulario() {
    comAtivos(resposta([]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
  }

  it("cada campo do formulário tem uma dica", async () => {
    await abrirFormulario();

    for (const campo of ["Tipo", "Símbolo", "Nome", "Quantidade", "Preço pago por unidade"]) {
      expect(screen.getByRole("button", { name: `ajuda sobre ${campo}` })).toBeInTheDocument();
    }
  });

  it("a dica do preço explica que é o valor de UMA unidade em reais", async () => {
    // É a dúvida que motivou a dica: "é quanto 1 real compra do ativo, ou
    // quanto custa 1 unidade dele?".
    await abrirFormulario();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "ajuda sobre Preço pago por unidade" }));

    const dica = screen.getByRole("tooltip").textContent!;
    expect(dica).toContain("UMA unidade");
    expect(dica).toContain("Não é quanto de cripto um real compra");
  });

  it("as colunas da tabela também têm dica", async () => {
    comAtivos(resposta([ativo()]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    for (const coluna of [
      "Descrição",
      "Qtd.",
      "Preço atual",
      "Vs. compra",
      "Custo",
      "Valor atual",
      "Resultado",
    ]) {
      expect(screen.getByRole("button", { name: `ajuda sobre ${coluna}` })).toBeInTheDocument();
    }
  });

  it("a dica do 'Vs. compra' distingue variação de preço do lucro da posição", async () => {
    comAtivos(resposta([ativo()]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    fireEvent.mouseEnter(screen.getByRole("button", { name: "ajuda sobre Vs. compra" }));

    expect(screen.getByRole("tooltip").textContent).toContain("comparação de preço com preço");
  });
});

describe("página /investimentos — coluna Descrição", () => {
  it("existe no cabeçalho, ao lado de Ativo", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByText("Descrição")).toBeInTheDocument());
    // O rótulo de cada cabeçalho vive num <span> próprio, separado do botão
    // de ajuda "?" que fica ao lado dele.
    const cabecalhos = Array.from(document.querySelectorAll("thead th")).map(
      (th) => th.querySelector("span > span")?.textContent ?? th.textContent,
    );
    expect(cabecalhos.slice(0, 2)).toEqual(["Ativo", "Descrição"]);
  });

  it("mostra a descrição já salva do ativo", async () => {
    comAtivos(resposta([ativo({ notes: "aporte da reserva" })]));

    render(<InvestimentosPage />);

    await waitFor(() =>
      expect(screen.getByLabelText("Descrição de BTC")).toHaveValue("aporte da reserva"),
    );
  });

  it("fica vazia quando o ativo não tem descrição", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);

    await waitFor(() => expect(screen.getByLabelText("Descrição de BTC")).toHaveValue(""));
  });

  it("grava a descrição digitada ao sair do campo", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    fireEvent.change(campo, { target: { value: "reserva de longo prazo" } });
    fireEvent.blur(campo);

    await waitFor(() => expect(chamadas("PATCH")).toHaveLength(1));
    const [url, init] = chamadas("PATCH")[0];
    expect(url).toBe("/api/investments/hold-1");
    expect(JSON.parse(init.body)).toEqual({ notes: "reserva de longo prazo" });
  });

  it("grava também no Enter (que só tira o foco do campo)", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    // O blur() do jsdom só dispara o evento se o campo estiver realmente
    // focado — sem o focus() aqui o teste passaria sem exercitar nada.
    campo.focus();
    fireEvent.change(campo, { target: { value: "airdrop" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    await waitFor(() => expect(chamadas("PATCH")).toHaveLength(1));
  });

  it("outra tecla não grava nada", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    fireEvent.change(campo, { target: { value: "airdrop" } });
    fireEvent.keyDown(campo, { key: "a" });

    expect(chamadas("PATCH")).toHaveLength(0);
  });

  it("apagar a descrição grava null, não string vazia", async () => {
    // "Sem descrição" é um único valor no banco (mesma regra da nota de aluguel).
    comAtivos(resposta([ativo({ notes: "antiga" })]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.blur(campo);

    await waitFor(() => expect(chamadas("PATCH")).toHaveLength(1));
    expect(JSON.parse(chamadas("PATCH")[0][1].body)).toEqual({ notes: null });
  });

  it("não grava quando a descrição não mudou", async () => {
    comAtivos(resposta([ativo({ notes: "igual" })]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    fireEvent.blur(campo);

    expect(chamadas("PATCH")).toHaveLength(0);
  });

  it("recarrega as cotações depois de gravar", async () => {
    comAtivos(resposta([ativo()]), resposta([ativo({ notes: "salva" })]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));

    fireEvent.change(campo, { target: { value: "salva" } });
    fireEvent.blur(campo);

    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => !c[1]?.method)).toHaveLength(2));
  });

  it("o recarregamento automático não apaga o que está sendo digitado", async () => {
    // A tela recarrega as cotações a cada 30s; o texto em edição vive em estado
    // local do componente justamente para sobreviver a isso.
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    const campo = await waitFor(() => screen.getByLabelText("Descrição de BTC"));
    fireEvent.change(campo, { target: { value: "digitando ainda" } });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(screen.getByLabelText("Descrição de BTC")).toHaveValue("digitando ainda");
  });
});

describe("página /investimentos — exclusão do ativo", () => {
  it("pede confirmação e remove o ativo com as compras dele", async () => {
    comAtivos(resposta([ativo()]));

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("BTC"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(window.confirm).toHaveBeenCalledWith("Remover este ativo e todas as compras dele?");
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

    expect(chamadas("DELETE")).toHaveLength(0);
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

describe("página /investimentos — nova compra", () => {
  async function abrirFormulario() {
    comAtivos(resposta([]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
  }

  function preencher(valores: Record<string, string>) {
    for (const [rotulo, valor] of Object.entries(valores)) {
      fireEvent.change(campoPorRotulo(rotulo), { target: { value: valor } });
    }
  }

  function enviar() {
    fireEvent.submit(document.querySelector("form")!);
  }

  it("abre e fecha pelo mesmo botão", async () => {
    await abrirFormulario();
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Registrar compra" })).not.toBeInTheDocument();
  });

  it("registra a compra com símbolo em caixa alta", async () => {
    await abrirFormulario();

    preencher({ Símbolo: "btc", Quantidade: "0,5", "Preço pago por unidade": "200000" });
    enviar();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/investments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "CRYPTO",
          symbol: "BTC",
          name: "BTC",
          quantity: 0.5,
          unitCostBrl: 200000,
          notes: null,
        }),
      }),
    );
  });

  it("usa o nome informado quando existe", async () => {
    await abrirFormulario();

    preencher({ Símbolo: "eth", Nome: "Ethereum", Quantidade: "2", "Preço pago por unidade": "10000" });
    enviar();

    await waitFor(() => expect(JSON.parse(chamadas("POST")[0][1].body).name).toBe("Ethereum"));
  });

  it("permite cadastrar moeda estrangeira", async () => {
    await abrirFormulario();

    preencher({ Tipo: "CURRENCY", Símbolo: "usd", Quantidade: "100", "Preço pago por unidade": "5,25" });
    enviar();

    await waitFor(() => {
      const corpo = JSON.parse(chamadas("POST")[0][1].body);
      expect(corpo.type).toBe("CURRENCY");
      expect(corpo.symbol).toBe("USD");
      expect(corpo.unitCostBrl).toBe(5.25);
    });
  });

  it("envia a descrição digitada", async () => {
    await abrirFormulario();

    preencher({
      Símbolo: "btc",
      Quantidade: "1",
      "Preço pago por unidade": "100",
      "Descrição (opcional)": "  compra na baixa  ",
    });
    enviar();

    await waitFor(() =>
      expect(JSON.parse(chamadas("POST")[0][1].body).notes).toBe("compra na baixa"),
    );
  });

  it("fecha o formulário e recarrega depois de registrar", async () => {
    comAtivos(
      resposta([], { totalCost: 0, totalCurrentValue: 0, totalGainLoss: 0, totalGainLossPercent: 0 }),
      resposta([ativo()]),
    );
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));

    preencher({ Símbolo: "btc", Quantidade: "1", "Preço pago por unidade": "100" });
    enviar();

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Registrar compra" })).not.toBeInTheDocument(),
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
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
    preencher({ Símbolo: "btc", Quantidade: "1", "Preço pago por unidade": "100" });
    enviar();

    await waitFor(() => expect(screen.getByRole("button", { name: "Registrar compra" })).toBeDisabled());
    liberar();
  });
});

describe("página /investimentos — valores com vírgula ou ponto", () => {
  async function abrirFormulario() {
    comAtivos(resposta([]));
    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
  }

  function preencher(valores: Record<string, string>) {
    for (const [rotulo, valor] of Object.entries(valores)) {
      fireEvent.change(campoPorRotulo(rotulo), { target: { value: valor } });
    }
  }

  it("aceita o mesmo número escrito com vírgula ou com ponto", async () => {
    await abrirFormulario();

    preencher({ Símbolo: "btc", Quantidade: "0,5", "Preço pago por unidade": "3.07" });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const corpo = JSON.parse(chamadas("POST")[0][1].body);
      expect(corpo.quantity).toBe(0.5);
      expect(corpo.unitCostBrl).toBe(3.07);
    });
  });

  it("aceita preço com separador de milhar (o caso que travava o cadastro)", async () => {
    // "350.000,00" virava NaN no `Number()` de antes, o corpo ia com null, a API
    // respondia 400 e a tela fechava o formulário sem dizer nada.
    await abrirFormulario();

    preencher({ Símbolo: "btc", Quantidade: "0,01", "Preço pago por unidade": "350.000,00" });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(JSON.parse(chamadas("POST")[0][1].body).unitCostBrl).toBe(350000));
  });

  it("avisa na tela e não envia quando o valor não é um número", async () => {
    await abrirFormulario();

    preencher({ Símbolo: "btc", Quantidade: "abc", "Preço pago por unidade": "100" });
    fireEvent.submit(document.querySelector("form")!);

    expect(screen.getByText(/precisam ser números/)).toBeInTheDocument();
    expect(chamadas("POST")).toHaveLength(0);
    // O formulário continua aberto para o usuário corrigir.
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeInTheDocument();
  });
});

describe("página /investimentos — erro e segunda compra", () => {
  it("mostra o erro da API e mantém o formulário aberto", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, json: async () => ({ error: { formErrors: ["nao deu"] } }) };
      }
      return { json: async () => resposta([]) };
    });

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço pago por unidade"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText(/nao deu/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Registrar compra" })).toBeInTheDocument();
  });

  it("mostra mensagem genérica quando a resposta de erro não traz detalhe", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, json: async () => ({}) };
      return { json: async () => resposta([]) };
    });

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço pago por unidade"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByText("Erro ao registrar a compra.")).toBeInTheDocument());
  });

  it("avisa quando a compra entrou numa posição que já existia", async () => {
    // A API responde `merged: true` em vez de criar uma linha nova; sem o aviso
    // a tela pareceria não ter feito nada.
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ merged: true }) };
      return { json: async () => resposta([ativo()]) };
    });

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço pago por unidade"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    // O aviso nomeia o ativo, para o usuário saber em qual posição a compra caiu.
    await waitFor(() =>
      expect(screen.getByText(/Compra registrada na posição que já existia de BTC/)).toBeInTheDocument(),
    );
  });

  it("o aviso desaparece ao abrir o formulário de novo", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ merged: true }) };
      return { json: async () => resposta([]) };
    });

    render(<InvestimentosPage />);
    await waitFor(() => screen.getByText("Custo total investido"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));
    fireEvent.change(campoPorRotulo("Símbolo"), { target: { value: "btc" } });
    fireEvent.change(campoPorRotulo("Quantidade"), { target: { value: "1" } });
    fireEvent.change(campoPorRotulo("Preço pago por unidade"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);
    await waitFor(() => expect(screen.getByText(/Compra registrada na posição/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "+ Nova compra" }));

    expect(screen.queryByText(/Compra registrada na posição/)).not.toBeInTheDocument();
  });
});
