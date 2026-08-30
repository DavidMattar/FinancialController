import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { campoPorRotulo } from "../helpers/dom";

vi.mock("@/components/TransactionsTable", () => ({
  default: ({ transactions, onCategoryChange, onDelete, onPendingReturnChange }: any) => (
    <div data-testid="tabela">
      <span>{transactions.length} transações</span>
      {transactions.map((t: any) => (
        <span key={t.id} data-testid={`tx-${t.id}`}>
          {t.id}:{String(t.pendingReturn)}
        </span>
      ))}
      <button type="button" onClick={() => onCategoryChange("tx-1", "cat-2")}>
        trocar categoria
      </button>
      <button type="button" onClick={() => onDelete("tx-1")}>
        excluir transação
      </button>
      <button type="button" onClick={() => onPendingReturnChange("tx-1", true)}>
        marcar pendência
      </button>
    </div>
  ),
}));

import TransacoesPage from "@/app/transacoes/page";

let fetchMock: ReturnType<typeof vi.fn>;

const categorias = [
  { id: "cat-1", name: "Supermercado", color: "#22c55e", icon: "cart", kind: "EXPENSE", keywords: [] },
  { id: "cat-2", name: "Salário", color: "#16a34a", icon: "wallet", kind: "INCOME", keywords: [] },
];

function comDados(transacoes: unknown[] = [{ id: "tx-1", pendingReturn: false }]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
    if (url === "/api/categories") return { json: async () => categorias };
    return { json: async () => transacoes };
  });
}

/** Última URL de listagem consultada. */
function ultimaListagem(): string {
  const chamadas = fetchMock.mock.calls.filter(
    (c) => String(c[0]).startsWith("/api/transactions?") && !c[1]?.method,
  );
  return decodeURIComponent(String(chamadas.at(-1)?.[0] ?? ""));
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

describe("página /transacoes — listagem e filtros", () => {
  it("busca as transações do mês corrente e as categorias", async () => {
    comDados();

    render(<TransacoesPage />);

    await waitFor(() => expect(ultimaListagem()).toContain("from=2026-08-01"));
    expect(ultimaListagem()).toContain("to=2026-08-31");
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<TransacoesPage />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("lista as transações devolvidas", async () => {
    comDados([{ id: "tx-1" }, { id: "tx-2" }]);

    render(<TransacoesPage />);

    await waitFor(() => expect(screen.getByTestId("tabela")).toHaveTextContent("2 transações"));
  });

  it("filtra por categoria", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "cat-1" } });

    await waitFor(() => expect(ultimaListagem()).toContain("categoryId=cat-1"));
  });

  it("filtra por 'sem categoria'", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "none" } });

    await waitFor(() => expect(ultimaListagem()).toContain("categoryId=none"));
  });

  it("filtra por tipo", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "PAYMENT" } });

    await waitFor(() => expect(ultimaListagem()).toContain("type=PAYMENT"));
  });

  it("busca por texto na descrição", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.change(screen.getByPlaceholderText("Buscar descrição..."), {
      target: { value: "uber" },
    });

    await waitFor(() => expect(ultimaListagem()).toContain("q=uber"));
  });

  it("não envia filtros vazios", async () => {
    comDados();

    render(<TransacoesPage />);

    await waitFor(() => expect(ultimaListagem()).toContain("from="));
    expect(ultimaListagem()).not.toContain("categoryId=");
    expect(ultimaListagem()).not.toContain("type=");
    expect(ultimaListagem()).not.toContain("q=");
  });

  it("trocar o período refaz a busca", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "Mês passado" }));

    await waitFor(() => expect(ultimaListagem()).toContain("from=2026-07-01"));
  });

  it("oferece as categorias no filtro", async () => {
    comDados();

    render(<TransacoesPage />);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Supermercado" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: "Todas as categorias" })).toBeInTheDocument();
  });
});

describe("página /transacoes — ações na tabela", () => {
  it("trocar a categoria salva e recarrega", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "trocar categoria" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: "cat-2" }),
      }),
    );
  });

  it("excluir pede confirmação antes", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "excluir transação" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", { method: "DELETE" }),
    );
    expect(window.confirm).toHaveBeenCalledWith("Excluir esta transação?");
  });

  it("cancelar a confirmação não exclui", async () => {
    comDados();
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "excluir transação" }));

    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });

  it("marcar pendência atualiza só a lista local", async () => {
    comDados([{ id: "tx-1", pendingReturn: false }, { id: "tx-2", pendingReturn: false }]);

    render(<TransacoesPage />);
    await waitFor(() => expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("tx-1:false"));
    const chamadas = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "marcar pendência" }));

    await waitFor(() => expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("tx-1:true"));
    expect(screen.getByTestId("tx-tx-2")).toHaveTextContent("tx-2:false");
    expect(fetchMock).toHaveBeenCalledTimes(chamadas);
  });
});

describe("página /transacoes — formulário manual", () => {
  async function abrirFormulario() {
    comDados();
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
  }

  it("o formulário começa escondido e abre pelo botão", async () => {
    comDados();
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("fecha pelo botão cancelar", async () => {
    await abrirFormulario();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
  });

  it("já vem com a data de hoje", async () => {
    await abrirFormulario();

    expect(campoPorRotulo("Data")).toHaveValue("2026-08-15");
  });

  it("cria a transação com os dados digitados", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "PADARIA" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "12,50" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: "2026-08-15",
          description: "PADARIA",
          amount: 12.5,
          type: "EXPENSE",
          categoryId: null,
        }),
      }),
    );
  });

  it("fecha o formulário e recarrega a lista depois de criar", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "10" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument());
  });

  it("escolher categoria de receita trava o tipo em Crédito", async () => {
    await abrirFormulario();

    const seletorCategoria = campoPorRotulo("Categoria");
    fireEvent.change(seletorCategoria, { target: { value: "cat-2" } });

    const seletorTipo = campoPorRotulo("Tipo");
    expect(seletorTipo).toHaveValue("INCOME");
    expect(seletorTipo).toBeDisabled();
    expect(seletorTipo).toHaveAttribute(
      "title",
      "Fixado como Receita por conta da categoria selecionada",
    );
  });

  it("categoria de despesa não trava o tipo", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Categoria"), { target: { value: "cat-1" } });

    const seletorTipo = campoPorRotulo("Tipo");
    expect(seletorTipo).not.toBeDisabled();
    expect(seletorTipo).toHaveValue("EXPENSE");
  });

  it("permite escolher o tipo manualmente quando a categoria não é de receita", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Tipo"), { target: { value: "PAYMENT" } });
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "PAGAMENTO" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "2000" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).type).toBe("PAYMENT");
    });
  });

  it("envia a categoria escolhida", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Categoria"), { target: { value: "cat-1" } });
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "MERCADO" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "50" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).categoryId).toBe("cat-1");
    });
  });

  it("desabilita o botão enquanto envia", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
        return { ok: true, json: async () => ({}) };
      }
      if (url === "/api/categories") return { json: async () => categorias };
      return { json: async () => [] };
    });

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "10" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled());
    liberar();
  });
});

describe("página /transacoes — data do formulário manual", () => {
  it("permite corrigir a data antes de salvar", async () => {
    comDados();
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    fireEvent.change(campoPorRotulo("Data"), { target: { value: "2026-07-20" } });
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "RETROATIVO" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "30" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).date).toBe("2026-07-20");
    });
  });
});
