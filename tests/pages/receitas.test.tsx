import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { normalizarEspacos as norm } from "../helpers/text";

vi.mock("@/components/SeasonalRentalsSection", () => ({
  default: () => <div data-testid="secao-alugueis">aluguéis de temporada</div>,
}));
vi.mock("@/components/TransactionsTable", () => ({
  default: ({ transactions, onCategoryChange }: any) => (
    <div data-testid="tabela">
      <span>{transactions.length} receitas</span>
      <button type="button" onClick={() => onCategoryChange("tx-1", "cat-2")}>
        trocar categoria
      </button>
      <button type="button" onClick={() => onCategoryChange("tx-1", null)}>
        limpar categoria
      </button>
    </div>
  ),
}));

import ReceitasPage from "@/app/receitas/page";

let fetchMock: ReturnType<typeof vi.fn>;

const resumo = {
  periodFrom: "2026-08-01",
  periodTo: "2026-08-31",
  totalIncome: 10000,
  freeToSpend: { percent: 15, allocated: 1500, spent: 500, available: 1000 },
  tithe: { percent: 10, amount: 1000 },
  investment: { percent: 75, amount: 7500 },
};

function comDados(receitas: unknown[] = [{ id: "tx-1", description: "SALARIO" }]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { json: async () => ({ ok: true }) };
    if (url === "/api/categories") return { json: async () => [{ id: "cat-1", name: "Salário" }] };
    if (url === "/api/budget/summary") return { json: async () => resumo };
    if (url.startsWith("/api/transactions")) return { json: async () => receitas };
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

describe("página /receitas", () => {
  it("busca só as receitas do mês corrente", async () => {
    comDados();

    render(<ReceitasPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions?type=INCOME&from=2026-08-01&to=2026-08-31",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/budget/summary");
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  it("mostra o mês corrente no título", async () => {
    comDados();

    render(<ReceitasPage />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Receitas — agosto de 2026/ })).toBeInTheDocument(),
    );
  });

  it("não mostra o mês no título antes do resumo chegar", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<ReceitasPage />);

    expect(screen.getByRole("heading", { name: "Receitas" })).toBeInTheDocument();
  });

  it("mostra os quatro cards da regra 15/10/75", async () => {
    comDados();

    render(<ReceitasPage />);

    await waitFor(() => expect(screen.getByText("Total de receitas no mês")).toBeInTheDocument());
    expect(screen.getByText("15% Disponível para gastar")).toBeInTheDocument();
    expect(screen.getByText("10% Dízimo")).toBeInTheDocument();
    expect(screen.getByText("75% Investimento")).toBeInTheDocument();

    const texto = norm(document.body.textContent);
    expect(texto).toContain(norm("R$ 10.000,00"));
    expect(texto).toContain(norm("R$ 1.000,00"));
    expect(texto).toContain(norm("R$ 7.500,00"));
    expect(texto).toContain(norm("de R$ 1.500,00 alocado"));
  });

  it("mostra 'Carregando...' antes das respostas", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<ReceitasPage />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("lista as receitas do mês", async () => {
    comDados([{ id: "tx-1" }, { id: "tx-2" }]);

    render(<ReceitasPage />);

    await waitFor(() => expect(screen.getByTestId("tabela")).toHaveTextContent("2 receitas"));
  });

  it("inclui a seção de aluguéis de temporada", async () => {
    comDados();

    render(<ReceitasPage />);

    expect(screen.getByTestId("secao-alugueis")).toBeInTheDocument();
  });

  it("trocar a categoria salva e recarrega tudo", async () => {
    comDados();

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    const chamadasAntes = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "trocar categoria" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: "cat-2" }),
      }),
    );
    // Recarrega as três rotas depois de salvar (o resumo pode mudar).
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(chamadasAntes + 1));
  });

  it("permite limpar a categoria de uma receita", async () => {
    comDados();

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "limpar categoria" }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(JSON.parse(patch![1].body)).toEqual({ categoryId: null });
    });
  });

  it("mostra disponível negativo quando a fatia dos 15% estourou", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/categories") return { json: async () => [] };
      if (url === "/api/budget/summary") {
        return {
          json: async () => ({
            ...resumo,
            freeToSpend: { percent: 15, allocated: 150, spent: 500, available: -350 },
          }),
        };
      }
      return { json: async () => [] };
    });

    render(<ReceitasPage />);

    await waitFor(() => expect(norm(document.body.textContent)).toContain(norm("-R$ 350,00")));
  });
});
