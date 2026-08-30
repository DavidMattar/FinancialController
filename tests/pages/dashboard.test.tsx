import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { normalizarEspacos as norm } from "../helpers/text";

/**
 * Os componentes filhos já têm testes próprios. Aqui eles são dublês para o
 * foco ficar no que é responsabilidade DA PÁGINA: quais rotas ela chama, com
 * qual período, o que ela faz com o resultado (inclusive o corte das 8
 * transações recentes) e o detalhe de o gráfico de evolução ser sempre dos
 * últimos 6 meses, independente do filtro escolhido.
 */
vi.mock("@/components/FreeToSpendBanner", () => ({
  default: () => <div data-testid="banner">banner de orçamento</div>,
}));
vi.mock("@/components/SavedViewsBar", () => ({
  default: ({ onApply }: any) => (
    <button type="button" onClick={() => onApply({ from: "2026-01-01", to: "2026-03-31" })}>
      aplicar visão salva
    </button>
  ),
}));
vi.mock("@/components/PendingReturnsPanel", () => ({
  default: () => <div data-testid="pendencias">pendências</div>,
}));
vi.mock("@/components/CategoryPieChart", () => ({
  default: ({ data, emptyMessage }: any) => (
    <div data-testid="pizza">
      {emptyMessage ?? "gastos"}: {data.length} fatias
    </div>
  ),
}));
vi.mock("@/components/MonthlyTrendChart", () => ({
  default: ({ data }: any) => <div data-testid="tendencia">{data.length} meses</div>,
}));
vi.mock("@/components/TransactionsTable", () => ({
  default: ({ transactions, onPendingReturnChange }: any) => (
    <div data-testid="tabela">
      <span>{transactions.length} transações</span>
      {transactions.map((t: any) => (
        <span key={t.id} data-testid={`tx-${t.id}`}>
          {t.id}:{String(t.pendingReturn)}
        </span>
      ))}
      <button type="button" onClick={() => onPendingReturnChange("tx-1", true)}>
        marcar pendência
      </button>
    </div>
  ),
}));

import DashboardPage from "@/app/page";

let fetchMock: ReturnType<typeof vi.fn>;

const metricas = {
  totalExpense: 1500,
  transactionCount: 12,
  averageTicket: 125,
  byCategory: [{ name: "Supermercado", color: "#22c55e", total: 800 }],
  byCategoryIncome: [],
  byMonth: [
    { month: "2026-03", total: 100 },
    { month: "2026-04", total: 200 },
  ],
  topMerchants: [
    { description: "IFOOD", total: 300 },
    { description: "UBER", total: 200 },
  ],
};

/** Cada rota devolve seu payload; `transacoes` controla a lista do ledger. */
function comDados(transacoes: unknown[] = []) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/categories") return { json: async () => [{ id: "cat-1", name: "Supermercado" }] };
    if (url.startsWith("/api/transactions/metrics")) return { json: async () => metricas };
    if (url.startsWith("/api/transactions")) return { json: async () => transacoes };
    throw new Error(`rota inesperada: ${url}`);
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("página / (dashboard)", () => {
  it("mostra 'Carregando...' antes das respostas", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<DashboardPage />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("busca métricas e transações do mês corrente", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions/metrics?from=2026-08-01&to=2026-08-31",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/transactions?from=2026-08-01&to=2026-08-31");
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  it("busca a evolução mensal sempre com os últimos 6 meses", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions/metrics?from=2026-03-01&to=2026-08-31",
      ),
    );
  });

  it("mostra os cards de resumo com os valores das métricas", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("Total gasto no período")).toBeInTheDocument());
    expect(norm(document.body.textContent)).toContain(norm("R$ 1.500,00"));
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("mostra os dois gráficos de pizza, com mensagem própria para ganhos", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getAllByTestId("pizza")).toHaveLength(2));
    expect(screen.getByText("Gastos por categoria")).toBeInTheDocument();
    expect(screen.getByText("Ganhos por categoria")).toBeInTheDocument();
    expect(screen.getByText(/Sem ganhos no período selecionado.*0 fatias/)).toBeInTheDocument();
  });

  it("mostra o banner de orçamento e o painel de pendências", async () => {
    comDados();

    render(<DashboardPage />);

    expect(screen.getByTestId("banner")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("pendencias")).toBeInTheDocument());
  });

  it("mostra a evolução com os meses devolvidos pela API", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByTestId("tendencia")).toHaveTextContent("2 meses"));
  });

  it("lista os maiores gastos por estabelecimento", async () => {
    comDados();

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("IFOOD")).toBeInTheDocument());
    expect(screen.getByText("UBER")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 300,00"));
  });

  it("mostra no máximo 8 transações recentes", async () => {
    const dez = Array.from({ length: 10 }, (_, i) => ({ id: `tx-${i}`, description: `T${i}` }));
    comDados(dez);

    render(<DashboardPage />);

    await waitFor(() => expect(screen.getByTestId("tabela")).toHaveTextContent("8 transações"));
  });

  it("rebusca os dados quando o período muda", async () => {
    comDados();

    render(<DashboardPage />);
    await waitFor(() => screen.getByText("Total gasto no período"));

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions/metrics?from=2026-07-01&to=2026-07-31",
      ),
    );
  });

  it("aplicar uma visão salva troca o período", async () => {
    comDados();

    render(<DashboardPage />);
    await waitFor(() => screen.getByText("Total gasto no período"));

    fireEvent.click(screen.getByRole("button", { name: "aplicar visão salva" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions/metrics?from=2026-01-01&to=2026-03-31",
      ),
    );
  });

  it("marcar pendência atualiza a transação na lista local, sem recarregar", async () => {
    comDados([{ id: "tx-1", description: "SHOPEE", pendingReturn: false }]);

    render(<DashboardPage />);
    await waitFor(() => expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("tx-1:false"));
    const chamadas = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "marcar pendência" }));

    await waitFor(() => expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("tx-1:true"));
    expect(fetchMock).toHaveBeenCalledTimes(chamadas);
  });

  it("não altera outras transações ao marcar a pendência de uma", async () => {
    comDados([
      { id: "tx-1", description: "SHOPEE", pendingReturn: false },
      { id: "tx-2", description: "PADARIA", pendingReturn: false },
    ]);

    render(<DashboardPage />);
    await waitFor(() => screen.getByTestId("tx-tx-2"));

    fireEvent.click(screen.getByRole("button", { name: "marcar pendência" }));

    await waitFor(() => expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("tx-1:true"));
    expect(screen.getByTestId("tx-tx-2")).toHaveTextContent("tx-2:false");
  });
});
