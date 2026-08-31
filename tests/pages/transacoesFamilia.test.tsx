import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TransacoesFamiliaPage from "@/app/transacoes-familia/page";
import { normalizarEspacos as norm } from "../helpers/text";
import { campoPorRotulo } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;

function lancamento(over: Record<string, unknown> = {}) {
  return {
    id: "fam-1",
    date: "2026-08-15",
    description: "Conta de luz",
    amount: "250.00",
    type: "EXPENSE",
    ...over,
  };
}

function comLancamentos(...listas: unknown[][]) {
  const fila = [...listas];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
    const proxima = fila.length > 1 ? fila.shift()! : fila[0];
    return { json: async () => proxima };
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

describe("página /transacoes-familia — listagem", () => {
  it("deixa explícito que o ledger é isolado do resto do app", async () => {
    comLancamentos([]);

    render(<TransacoesFamiliaPage />);

    expect(screen.getByRole("heading", { name: "Transações Família" })).toBeInTheDocument();
    expect(
      screen.getByText(/não aparece em relatórios, métricas ou no\s+orçamento/),
    ).toBeInTheDocument();
  });

  it("busca os lançamentos do mês corrente na rota própria da família", async () => {
    comLancamentos([]);

    render(<TransacoesFamiliaPage />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/family-transactions?from=2026-08-01&to=2026-08-31",
      ),
    );
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<TransacoesFamiliaPage />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("avisa quando não há lançamento no período", async () => {
    comLancamentos([]);

    render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText("Nenhuma transação encontrada.")).toBeInTheDocument());
  });

  it("lista data, descrição, tipo e valor", async () => {
    comLancamentos([lancamento()]);

    render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText("Conta de luz")).toBeInTheDocument());
    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(screen.getByText("Despesa")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 250,00"));
  });

  it("traduz o tipo receita", async () => {
    comLancamentos([lancamento({ type: "INCOME" })]);

    render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText("Receita")).toBeInTheDocument());
  });

  it("trocar o período refaz a busca", async () => {
    comLancamentos([]);

    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/family-transactions?from=2026-07-01&to=2026-07-31",
      ),
    );
  });
});

describe("página /transacoes-familia — resumo do período", () => {
  it("soma receitas e gastos e mostra o resultado positivo em verde", async () => {
    comLancamentos([
      lancamento({ id: "f1", type: "INCOME", amount: "1000.00" }),
      lancamento({ id: "f2", type: "EXPENSE", amount: "250.00" }),
    ]);

    const { container } = render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText(/Receitas no período/)).toBeInTheDocument());
    const texto = norm(document.body.textContent);
    expect(texto).toContain(norm("Receitas no período: R$ 1.000,00"));
    expect(texto).toContain(norm("Gastos no período: R$ 250,00"));
    expect(norm(container.querySelector(".text-2xl")!.textContent)).toBe(norm("R$ 750,00"));
    expect(screen.getByText("Resultado do período").closest("div")!.parentElement!.className).toContain(
      "emerald",
    );
  });

  it("mostra o resultado negativo em vermelho", async () => {
    comLancamentos([lancamento({ amount: "250.00" })]);

    const { container } = render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText(/Gastos no período/)).toBeInTheDocument());
    expect(norm(container.querySelector(".text-2xl")!.textContent)).toBe(norm("-R$ 250,00"));
    expect(screen.getByText("Resultado do período").closest("div")!.parentElement!.className).toContain(
      "red",
    );
  });

  it("resultado zero conta como positivo (verde)", async () => {
    comLancamentos([
      lancamento({ id: "f1", type: "INCOME", amount: "100.00" }),
      lancamento({ id: "f2", type: "EXPENSE", amount: "100.00" }),
    ]);

    const { container } = render(<TransacoesFamiliaPage />);

    await waitFor(() => expect(screen.getByText(/Receitas no período/)).toBeInTheDocument());
    expect(norm(container.querySelector(".text-2xl")!.textContent)).toBe(norm("R$ 0,00"));
    expect(screen.getByText("Resultado do período").closest("div")!.parentElement!.className).toContain(
      "emerald",
    );
  });

  it("mostra tudo zerado quando não há lançamento", async () => {
    comLancamentos([]);

    const { container } = render(<TransacoesFamiliaPage />);

    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));
    expect(norm(container.querySelector(".text-2xl")!.textContent)).toBe(norm("R$ 0,00"));
  });
});

describe("página /transacoes-familia — exclusão", () => {
  it("pede confirmação nomeando o lançamento", async () => {
    comLancamentos([lancamento()]);

    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Conta de luz"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(screen.getByText("Excluir transação")).toBeInTheDocument();
    expect(screen.getByText(/Excluir "Conta de luz"\?/)).toBeInTheDocument();
  });

  it("confirmar exclui e recarrega", async () => {
    comLancamentos([lancamento()], []);

    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Conta de luz"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/family-transactions/fam-1", {
        method: "DELETE",
      }),
    );
    await waitFor(() => expect(screen.getByText("Nenhuma transação encontrada.")).toBeInTheDocument());
  });

  it("cancelar não exclui", async () => {
    comLancamentos([lancamento()]);

    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Conta de luz"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText("Excluir transação")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });
});

describe("página /transacoes-familia — formulário", () => {
  async function abrirFormulario() {
    comLancamentos([]);
    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
  }

  it("abre e fecha pelo mesmo botão", async () => {
    await abrirFormulario();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
  });

  it("já vem com a data de hoje", async () => {
    await abrirFormulario();
    expect(campoPorRotulo("Data")).toHaveValue("2026-08-15");
  });

  it("aceita o valor com separador de milhar e ponto decimal", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "Reforma" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "1.234,56" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).amount).toBe(1234.56);
    });
  });

  it("avisa e não envia quando o valor não é um número", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "abc" } });
    fireEvent.submit(document.querySelector("form")!);

    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  });

  it("cria o lançamento com os dados digitados", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "Internet" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "129,90" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/family-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-08-15",
          description: "Internet",
          amount: 129.9,
          type: "EXPENSE",
        }),
      }),
    );
  });

  it("permite lançar uma receita", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Tipo"), { target: { value: "INCOME" } });
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "Aporte" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "500" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).type).toBe("INCOME");
    });
  });

  it("fecha o formulário e recarrega a lista depois de criar", async () => {
    comLancamentos([], [lancamento({ description: "Internet" })]);
    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "Internet" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "100" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Internet")).toBeInTheDocument());
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
      return { json: async () => [] };
    });

    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "10" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled());
    liberar();
  });
});

describe("página /transacoes-familia — data do formulário", () => {
  it("permite corrigir a data antes de salvar", async () => {
    comLancamentos([]);
    render(<TransacoesFamiliaPage />);
    await waitFor(() => screen.getByText("Nenhuma transação encontrada."));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    fireEvent.change(campoPorRotulo("Data"), { target: { value: "2026-07-10" } });
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "Água" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "80" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).date).toBe("2026-07-10");
    });
  });
});
