import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { normalizarEspacos as norm } from "../helpers/text";

vi.mock("@/components/SeasonalRentalsSection", () => ({
  default: () => <div data-testid="secao-alugueis">aluguéis de temporada</div>,
}));
/**
 * A tabela é dublada por um painel de botões, um por callback que a página
 * passa: o que se testa aqui é o que a PÁGINA faz quando a tabela avisa uma
 * edição (corpo do PATCH, releitura, diálogo de exclusão) — a tabela em si tem
 * os próprios testes. `editavel-<id>` expõe o resultado do `isRowEditable`
 * que a página monta, que é a regra do "Aluguel Rancho".
 */
vi.mock("@/components/TransactionsTable", () => ({
  default: ({
    transactions,
    onCategoryChange,
    onDateChange,
    onDescriptionChange,
    onAmountChange,
    onDelete,
    isRowEditable,
  }: any) => (
    <div data-testid="tabela">
      <span>{transactions.length} receitas</span>
      <button type="button" onClick={() => onCategoryChange("tx-1", "cat-2")}>
        trocar categoria
      </button>
      <button type="button" onClick={() => onCategoryChange("tx-1", null)}>
        limpar categoria
      </button>
      <button type="button" onClick={() => onDateChange("tx-1", "2026-08-20")}>
        trocar data
      </button>
      <button type="button" onClick={() => onDescriptionChange("tx-1", "SALARIO NOVO")}>
        trocar descrição
      </button>
      <button type="button" onClick={() => onAmountChange("tx-1", 4321.5)}>
        trocar valor
      </button>
      <button type="button" onClick={() => onDelete("tx-1")}>
        pedir exclusão
      </button>
      {transactions.map((t: any) => (
        <span key={t.id} data-testid={`editavel-${t.id}`}>
          {String(isRowEditable(t))}
        </span>
      ))}
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
  months: [
    {
      month: "2026-08",
      income: 10000,
      allocated: 1500,
      spent: 500,
      monthAvailable: 1000,
      cumulativeAvailable: 1000,
    },
  ],
};

function comDados(receitas: unknown[] = [{ id: "tx-1", description: "SALARIO" }]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { json: async () => ({ ok: true }) };
    if (url === "/api/categories") return { json: async () => [{ id: "cat-1", name: "Salário" }] };
    if (url.startsWith("/api/budget/summary")) return { json: async () => resumo };
    if (url.startsWith("/api/transactions")) return { json: async () => receitas };
    throw new Error(`rota inesperada: ${url}`);
  });
}

/** A URL da última chamada a uma rota (o teste confere o período pedido). */
function ultimaChamada(prefixo: string): string {
  const chamadas = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(prefixo));
  return String(chamadas[chamadas.length - 1][0]);
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
  it("começa no mês corrente e busca receitas e orçamento desse mês", async () => {
    comDados();

    render(<ReceitasPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/transactions?type=INCOME&from=2026-08-01&to=2026-08-31",
      ),
    );
    // O resumo 15/10/75 é pedido para o MESMO mês, não mais fixo no corrente.
    expect(fetchMock).toHaveBeenCalledWith("/api/budget/summary?from=2026-08-01&to=2026-08-31");
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  it("mostra o mês corrente selecionado nos seletores do título", async () => {
    comDados();

    render(<ReceitasPage />);

    expect(screen.getByText(/Receitas —/)).toBeInTheDocument();
    expect((screen.getByLabelText("Mês") as HTMLSelectElement).value).toBe("8");
    expect((screen.getByLabelText("Ano") as HTMLSelectElement).value).toBe("2026");
  });

  it("oferece os doze meses em português e uma janela de anos", async () => {
    comDados();

    render(<ReceitasPage />);

    const meses = screen.getByLabelText("Mês") as HTMLSelectElement;
    expect(meses.options).toHaveLength(12);
    expect(meses.options[0].textContent).toBe("janeiro");
    expect(meses.options[11].textContent).toBe("dezembro");

    const anos = Array.from((screen.getByLabelText("Ano") as HTMLSelectElement).options).map(
      (o) => o.value,
    );
    // Cinco anos para trás e um para frente, em volta de 2026.
    expect(anos).toEqual(["2021", "2022", "2023", "2024", "2025", "2026", "2027"]);
  });

  it("trocar o mês rebusca as receitas e o orçamento do mês escolhido", async () => {
    comDados();

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2" } });

    await waitFor(() =>
      expect(ultimaChamada("/api/transactions?type=INCOME")).toBe(
        "/api/transactions?type=INCOME&from=2026-02-01&to=2026-02-28",
      ),
    );
    expect(ultimaChamada("/api/budget/summary")).toBe(
      "/api/budget/summary?from=2026-02-01&to=2026-02-28",
    );
  });

  it("trocar o ano rebusca o mesmo mês no ano escolhido (inclusive fevereiro bissexto)", async () => {
    comDados();

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2" } });
    await waitFor(() => expect(ultimaChamada("/api/budget/summary")).toContain("2026-02"));
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "2024" } });

    await waitFor(() =>
      expect(ultimaChamada("/api/budget/summary")).toBe(
        "/api/budget/summary?from=2024-02-01&to=2024-02-29",
      ),
    );
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

  it("não mostra os cards antes do resumo chegar (mas o título já aparece)", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<ReceitasPage />);

    expect(screen.getByText(/Receitas —/)).toBeInTheDocument();
    expect(screen.queryByText("Total de receitas no mês")).not.toBeInTheDocument();
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
      if (url.startsWith("/api/budget/summary")) {
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

describe("página /receitas — edição dos lançamentos", () => {
  /** Uma receita comum (editável) e a receita auto-criada por um aluguel. */
  const salario = {
    id: "tx-1",
    description: "SALARIO",
    amount: "5000.00",
    category: { id: "cat-1", name: "Salário" },
  };
  const receitaDeAluguel = {
    id: "tx-2",
    description: "Repasse aluguel de temporada",
    amount: "1000.00",
    category: { id: "cat-9", name: "Aluguel Rancho" },
  };

  /** O corpo JSON da última escrita feita pela página. */
  function ultimaEscrita() {
    const chamadas = fetchMock.mock.calls.filter((c) => c[1]?.method);
    return chamadas[chamadas.length - 1];
  }

  it("libera a edição das receitas comuns", async () => {
    comDados([salario]);

    render(<ReceitasPage />);

    await waitFor(() => expect(screen.getByTestId("editavel-tx-1")).toHaveTextContent("true"));
  });

  it("bloqueia a edição das receitas da categoria Aluguel Rancho", async () => {
    // O valor dessas linhas é o "Total David" calculado pelo aluguel: quem
    // manda nelas é o modal de aluguel, não o ledger.
    comDados([salario, receitaDeAluguel]);

    render(<ReceitasPage />);

    await waitFor(() => expect(screen.getByTestId("editavel-tx-2")).toHaveTextContent("false"));
    expect(screen.getByTestId("editavel-tx-1")).toHaveTextContent("true");
  });

  it("libera a edição de receita sem categoria", async () => {
    comDados([{ id: "tx-1", description: "PIX RECEBIDO", amount: "100.00", category: null }]);

    render(<ReceitasPage />);

    await waitFor(() => expect(screen.getByTestId("editavel-tx-1")).toHaveTextContent("true"));
  });

  it("grava a nova data por PATCH", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "trocar data" }));

    await waitFor(() => {
      const [url, init] = ultimaEscrita();
      expect(url).toBe("/api/transactions/tx-1");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toEqual({ date: "2026-08-20" });
    });
  });

  it("grava a nova descrição por PATCH", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "trocar descrição" }));

    await waitFor(() =>
      expect(JSON.parse(ultimaEscrita()[1].body)).toEqual({ description: "SALARIO NOVO" }),
    );
  });

  it("grava o novo valor por PATCH", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "trocar valor" }));

    await waitFor(() => expect(JSON.parse(ultimaEscrita()[1].body)).toEqual({ amount: 4321.5 }));
  });

  it("relê os lançamentos E o resumo depois de editar (o 15/10/75 muda com a receita)", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    const antes = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "trocar valor" }));

    // PATCH + as três rotas da releitura.
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(antes + 4));
    expect(ultimaChamada("/api/budget/summary")).toBe(
      "/api/budget/summary?from=2026-08-01&to=2026-08-31",
    );
  });

  it("a releitura de depois da edição não troca a tabela por 'Carregando...'", async () => {
    // Ligar o loading remontaria o campo que acabou de ser editado e fecharia
    // o detalhamento aberto — barulho visual a cada Enter.
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "trocar valor" }));

    expect(screen.queryByText("Carregando...")).not.toBeInTheDocument();
    expect(screen.getByTestId("tabela")).toBeInTheDocument();
  });
});

describe("página /receitas — exclusão de lançamento", () => {
  const salario = {
    id: "tx-1",
    description: "SALARIO",
    amount: "5000.00",
    category: { id: "cat-1", name: "Salário" },
  };

  it("pede confirmação antes de excluir, mostrando descrição e valor", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "pedir exclusão" }));

    expect(screen.getByText("Excluir receita")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm('Excluir "SALARIO" de R$ 5.000,00?'));
    // Nada foi enviado antes da confirmação.
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method)).toHaveLength(0);
  });

  it("cancelar fecha o diálogo sem excluir", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "pedir exclusão" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText("Excluir receita")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method)).toHaveLength(0);
  });

  it("confirmar exclui e relê a tela", async () => {
    comDados([salario]);

    render(<ReceitasPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "pedir exclusão" }));
    const antes = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", { method: "DELETE" }),
    );
    // DELETE + as três rotas da releitura (o total do mês mudou).
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(antes + 4));
    expect(screen.queryByText("Excluir receita")).not.toBeInTheDocument();
  });
});
