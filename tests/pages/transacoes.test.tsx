import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { campoPorRotulo } from "../helpers/dom";

vi.mock("@/components/TransactionsTable", () => ({
  default: ({
    transactions,
    onCategoryChange,
    onDateChange,
    onDescriptionChange,
    onDelete,
    onPendingReturnChange,
    onMoveToFamily,
  }: any) => (
    <div data-testid="tabela">
      <span>{transactions.length} transações</span>
      {transactions.map((t: any) => (
        <span key={t.id} data-testid={`tx-${t.id}`}>
          {t.id}:{String(t.pendingReturn)}:{t.description}:{t.date}
        </span>
      ))}
      <button type="button" onClick={() => onCategoryChange("tx-1", "cat-2")}>
        trocar categoria
      </button>
      <button type="button" onClick={() => onDateChange("tx-1", "2026-08-05")}>
        trocar data
      </button>
      <button type="button" onClick={() => onDateChange("tx-1", "2026-09-02")}>
        trocar data p/ setembro
      </button>
      <button type="button" onClick={() => onDescriptionChange("tx-1", "Feira do mês")}>
        trocar descrição
      </button>
      <button type="button" onClick={() => onDelete("tx-1")}>
        excluir transação
      </button>
      <button type="button" onClick={() => onPendingReturnChange("tx-1", true)}>
        marcar pendência
      </button>
      {transactions.map((t: any) => (
        <button key={t.id} type="button" onClick={() => onMoveToFamily(t)}>
          mover {t.id}
        </button>
      ))}
    </div>
  ),
}));

import TransacoesPage from "@/app/transacoes/page";

let fetchMock: ReturnType<typeof vi.fn>;

const categorias = [
  { id: "cat-1", name: "Supermercado", color: "#22c55e", icon: "cart", kind: "EXPENSE", keywords: [] },
  { id: "cat-2", name: "Salário", color: "#16a34a", icon: "wallet", kind: "INCOME", keywords: [] },
];

/**
 * Transação de exemplo com os campos que a tela lê para decidir se a linha
 * editada continua na lista (data, descrição, categoria, tipo).
 */
function tx(over: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    date: "2026-08-15",
    description: "SUPERMERCADO BH",
    type: "EXPENSE",
    categoryId: "cat-1",
    pendingReturn: false,
    ...over,
  };
}

function comDados(transacoes: any[] = [tx()]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    // O PATCH devolve a transação já atualizada (é o que a rota faz), porque é
    // dela que a tela monta a linha nova — sem recarregar a lista.
    if (init?.method === "PATCH") {
      const id = String(url).split("/").pop();
      const base = transacoes.find((t) => t.id === id) ?? {};
      return { ok: true, json: async () => ({ ...base, ...JSON.parse(String(init.body)) }) };
    }
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
  /** Quantidade de listagens (GET) já pedidas ao servidor. */
  function listagens(): number {
    return fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith("/api/transactions?") && !c[1]?.method,
    ).length;
  }

  /** Ids das linhas na ordem em que a tabela as recebeu. */
  function idsNaOrdem(): string[] {
    return screen.getAllByTestId(/^tx-tx-/).map((el) => el.textContent!.split(":")[0]);
  }

  it("trocar a categoria salva sem recarregar a lista", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    const antes = listagens();

    fireEvent.click(screen.getByRole("button", { name: "trocar categoria" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: "cat-2" }),
      }),
    );
    // A linha é atualizada no lugar: recarregar trocaria a tabela inteira por
    // "Carregando...", fechando o detalhamento aberto e o campo em edição.
    expect(listagens()).toBe(antes);
    expect(screen.getByTestId("tx-tx-1")).toBeInTheDocument();
  });

  it("editar a descrição atualiza a linha com a resposta do servidor", async () => {
    comDados();

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    const antes = listagens();

    fireEvent.click(screen.getByRole("button", { name: "trocar descrição" }));

    await waitFor(() =>
      expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("Feira do mês"),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Feira do mês" }),
    });
    expect(listagens()).toBe(antes);
  });

  it("editar a data dentro do período reordena a lista sem recarregar", async () => {
    comDados([tx(), tx({ id: "tx-2", date: "2026-08-10", description: "PADARIA" })]);

    render(<TransacoesPage />);
    await waitFor(() => expect(idsNaOrdem()).toEqual(["tx-1", "tx-2"]));
    const antes = listagens();

    // 05/08 é anterior ao 10/08 da outra linha: a tabela é ordenada da mais
    // recente para a mais antiga, como o orderBy da rota.
    fireEvent.click(screen.getByRole("button", { name: "trocar data" }));

    await waitFor(() => expect(idsNaOrdem()).toEqual(["tx-2", "tx-1"]));
    expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("2026-08-05");
    expect(listagens()).toBe(antes);
  });

  it("data fora do período filtrado tira a linha da lista", async () => {
    comDados([tx(), tx({ id: "tx-2", date: "2026-08-10", description: "PADARIA" })]);

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tx-tx-1"));

    // O filtro é o mês corrente (agosto/2026): setembro não pertence mais à
    // lista, então a linha sai — o mesmo resultado que o recarregamento dava.
    fireEvent.click(screen.getByRole("button", { name: "trocar data p/ setembro" }));

    await waitFor(() => expect(screen.queryByTestId("tx-tx-1")).not.toBeInTheDocument());
    expect(screen.getByTestId("tx-tx-2")).toBeInTheDocument();
  });

  it("PATCH que falha não altera a linha", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: false, status: 400, json: async () => ({ error: "x" }) };
      if (url === "/api/categories") return { json: async () => categorias };
      return { json: async () => [tx()] };
    });

    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "trocar descrição" }));

    // O corpo de uma resposta fora de 2xx é um objeto de erro, não a transação:
    // aplicá-lo apagaria a linha da tela. O pop-up global já explica a falha.
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true));
    expect(screen.getByTestId("tx-tx-1")).toHaveTextContent("SUPERMERCADO BH");
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

  it("aceita o valor com separador de milhar e ponto decimal", async () => {
    // Antes só uma vírgula sozinha funcionava: "1.234,56" virava NaN, o corpo
    // ia com null e a API respondia 400 sem que a tela mostrasse nada.
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "GELADEIRA" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "1.234,56" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).amount).toBe(1234.56);
    });
  });

  it("avisa e não envia quando o valor não é um número", async () => {
    await abrirFormulario();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "abc" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
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
          pendingReturn: false,
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

/**
 * O checkbox "Verificar devolução" no formulário manual permite marcar a
 * pendência já na criação, em vez de abrir a transação depois. Não tem a trava
 * de e-commerce do painel da transação existente (ver TransactionItemsPanel):
 * na hora de lançar, quem decide é o usuário.
 */
describe("página /transacoes — verificar devolução na criação", () => {
  async function abrirFormularioLimpo() {
    comDados();
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
  }

  /** Corpo JSON do POST de criação da transação. */
  function corpoCriado() {
    const post = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/transactions" && c[1]?.method === "POST",
    );
    return JSON.parse(post![1].body);
  }

  it("o checkbox aparece sempre, sem depender da descrição", async () => {
    await abrirFormularioLimpo();

    expect(screen.getByLabelText(/Verificar devolução/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Verificar devolução/)).not.toBeChecked();
  });

  it("envia pendingReturn true quando marcado", async () => {
    await abrirFormularioLimpo();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "COMPRA ONLINE" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "99,90" } });
    fireEvent.click(screen.getByLabelText(/Verificar devolução/));
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(corpoCriado().pendingReturn).toBe(true));
  });

  it("envia false quando não marcado", async () => {
    await abrirFormularioLimpo();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "PADARIA" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "10" } });
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(corpoCriado().pendingReturn).toBe(false));
  });

  it("desmarcar antes de salvar volta a enviar false", async () => {
    await abrirFormularioLimpo();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "PADARIA" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText(/Verificar devolução/));
    fireEvent.click(screen.getByLabelText(/Verificar devolução/));
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(corpoCriado().pendingReturn).toBe(false));
  });

  it("marcar não bloqueia nem muda o tipo da transação", async () => {
    await abrirFormularioLimpo();

    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: "SERVIÇO" } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: "50" } });
    fireEvent.click(screen.getByLabelText(/Verificar devolução/));
    fireEvent.submit(document.querySelectorAll("form")[0]);

    await waitFor(() => expect(corpoCriado().type).toBe("EXPENSE"));
  });
});

/**
 * Mover para a família apaga a transação do ledger principal e cria a
 * equivalente no ledger isolado, então a interface pede confirmação e é
 * explícita sobre o que se perde (o ledger da família não tem categoria,
 * cartão, fatura, parcelamento nem devolução pendente).
 */
describe("página /transacoes — mover para Transações Família", () => {
  async function comLista(transacoes: unknown[]) {
    comDados(transacoes);
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
  }

  it("pede confirmação antes de mover", async () => {
    await comLista([{ id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false }]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Mover "PADARIA" para Transações Família\?/)).toBeInTheDocument();
    // Nada é enviado enquanto o usuário não confirma.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("move-to-family"))).toBe(false);
  });

  it("avisa o que se perde na movimentação", async () => {
    await comLista([{ id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false }]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));

    expect(screen.getByText(/Categoria, cartão, fatura, parcelamento/)).toBeInTheDocument();
    expect(screen.getByText(/Não há como desfazer pela interface/)).toBeInTheDocument();
  });

  it("chama a rota de movimentação e recarrega a lista ao confirmar", async () => {
    await comLista([{ id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false }]);
    const listagensAntes = fetchMock.mock.calls.filter(
      (c) => String(c[0]).startsWith("/api/transactions?") && !c[1]?.method,
    ).length;

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1/move-to-family", {
        method: "POST",
      }),
    );
    await waitFor(() => {
      const depois = fetchMock.mock.calls.filter(
        (c) => String(c[0]).startsWith("/api/transactions?") && !c[1]?.method,
      ).length;
      expect(depois).toBeGreaterThan(listagensAntes);
    });
  });

  it("fecha o diálogo depois de mover", async () => {
    await comLista([{ id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false }]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("cancelar não move nada", async () => {
    await comLista([{ id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false }]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("move-to-family"))).toBe(false);
  });

  it("avisa que Pagamento vira Despesa no ledger da família", async () => {
    await comLista([
      { id: "tx-1", description: "PAGAMENTO FATURA", type: "PAYMENT", pendingReturn: false },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));

    expect(screen.getByText(/entrará como Despesa/)).toBeInTheDocument();
  });

  it("não mostra o aviso de conversão em despesa e crédito", async () => {
    await comLista([
      { id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false },
      { id: "tx-2", description: "SALÁRIO", type: "INCOME", pendingReturn: false },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));
    expect(screen.queryByText(/entrará como Despesa/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "mover tx-2" }));
    expect(screen.queryByText(/entrará como Despesa/)).not.toBeInTheDocument();
  });

  it("move a transação escolhida, não a primeira da lista", async () => {
    await comLista([
      { id: "tx-1", description: "PADARIA", type: "EXPENSE", pendingReturn: false },
      { id: "tx-2", description: "FEIRA", type: "EXPENSE", pendingReturn: false },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "mover tx-2" }));

    expect(screen.getByText(/Mover "FEIRA"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mover" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-2/move-to-family", {
        method: "POST",
      }),
    );
  });

  it("mostra 'Movendo...' enquanto a rota não responde", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("move-to-family")) {
        await new Promise<void>((resolve) => {
          liberar = resolve;
        });
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
      if (url === "/api/categories") return { json: async () => categorias };
      return { json: async () => [{ id: "tx-1", description: "PADARIA", type: "EXPENSE" }] };
    });
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));

    fireEvent.click(screen.getByRole("button", { name: "mover tx-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Movendo..." })).toBeInTheDocument(),
    );
    liberar();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});

describe("página /transacoes — continuar lançando", () => {
  const CONTINUAR = /Continuar lançando/;

  /** Abre o formulário de nova transação com a lista já carregada. */
  async function abrirFormulario() {
    comDados();
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
  }

  /** Preenche descrição e valor e envia o formulário. */
  function lancar(descricao: string, valor: string) {
    fireEvent.change(campoPorRotulo("Descrição"), { target: { value: descricao } });
    fireEvent.change(campoPorRotulo("Valor"), { target: { value: valor } });
    fireEvent.submit(document.querySelectorAll("form")[0]);
  }

  /** Os corpos JSON de todos os POSTs feitos até agora. */
  function lancamentosEnviados() {
    return fetchMock.mock.calls
      .filter((c) => c[1]?.method === "POST")
      .map((c) => JSON.parse(String(c[1].body)));
  }

  it("o checkbox começa desmarcado (salvar fecha, como antes)", async () => {
    await abrirFormulario();

    expect(screen.getByRole("checkbox", { name: CONTINUAR })).not.toBeChecked();
  });

  it("marcado, o formulário continua aberto depois de salvar", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(lancamentosEnviados()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });

  it("limpa descrição e valor, mas mantém data, tipo e categoria", async () => {
    // Quem lança várias seguidas costuma estar no mesmo dia/categoria —
    // reescrever isso a cada linha anularia o ganho do checkbox.
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));
    fireEvent.change(campoPorRotulo("Data"), { target: { value: "2026-08-10" } });
    fireEvent.change(campoPorRotulo("Categoria"), { target: { value: "cat-1" } });
    fireEvent.change(campoPorRotulo("Tipo"), { target: { value: "PAYMENT" } });

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(campoPorRotulo("Descrição")).toHaveValue(""));
    expect(campoPorRotulo("Valor")).toHaveValue("");
    expect(campoPorRotulo("Data")).toHaveValue("2026-08-10");
    expect(campoPorRotulo("Categoria")).toHaveValue("cat-1");
    expect(campoPorRotulo("Tipo")).toHaveValue("PAYMENT");
  });

  it("desmarca 'verificar devolução' a cada lançamento", async () => {
    // É marca de um item específico, não da sessão de lançamento: herdar isso
    // no próximo lançaria uma pendência que ninguém pediu.
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Verificar devolução/ }));

    lancar("COMPRA ONLINE", "80");

    await waitFor(() => expect(lancamentosEnviados()[0].pendingReturn).toBe(true));
    expect(screen.getByRole("checkbox", { name: /Verificar devolução/ })).not.toBeChecked();
  });

  it("o checkbox continua marcado para o lançamento seguinte", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(campoPorRotulo("Descrição")).toHaveValue(""));
    expect(screen.getByRole("checkbox", { name: CONTINUAR })).toBeChecked();
  });

  it("devolve o foco para a descrição, pronto para o próximo", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(document.activeElement).toBe(campoPorRotulo("Descrição")));
  });

  it("lança várias seguidas sem reabrir o formulário", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");
    await waitFor(() => expect(campoPorRotulo("Descrição")).toHaveValue(""));
    lancar("FARMACIA", "30");
    await waitFor(() => expect(lancamentosEnviados()).toHaveLength(2));
    lancar("POSTO", "100");
    await waitFor(() => expect(lancamentosEnviados()).toHaveLength(3));

    expect(lancamentosEnviados().map((l) => [l.description, l.amount])).toEqual([
      ["PADARIA", 12.5],
      ["FARMACIA", 30],
      ["POSTO", 100],
    ]);
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });

  it("conta os lançamentos salvos (o formulário aberto esconde a lista)", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");
    await waitFor(() => expect(screen.getByText("✓ 1 lançamento salvo")).toBeInTheDocument());

    lancar("FARMACIA", "30");
    await waitFor(() => expect(screen.getByText("✓ 2 lançamentos salvos")).toBeInTheDocument());
  });

  it("recarrega a lista mesmo com o formulário aberto", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));
    const antes = fetchMock.mock.calls.filter((c) => !c[1]?.method).length;

    lancar("PADARIA", "12,50");

    // O lançamento novo tem que aparecer atrás do formulário que ficou aberto.
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => !c[1]?.method).length).toBeGreaterThan(antes),
    );
  });

  it("desmarcado, salvar fecha o formulário (comportamento de antes)", async () => {
    await abrirFormulario();

    lancar("PADARIA", "12,50");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument(),
    );
  });

  it("reabrir o formulário começa com o checkbox desmarcado", async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    expect(screen.getByRole("checkbox", { name: CONTINUAR })).not.toBeChecked();
  });

  it("resposta de erro não limpa o que foi digitado nem fecha o formulário", async () => {
    // Perder o lançamento inteiro junto com o erro é o pior desfecho possível:
    // o pop-up global já explica a falha, e o texto fica para ser corrigido.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, json: async () => ({ error: "ruim" }) };
      if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
      if (url === "/api/categories") return { json: async () => categorias };
      return { json: async () => [tx()] };
    });
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));
    fireEvent.click(screen.getByRole("checkbox", { name: CONTINUAR }));

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(lancamentosEnviados()).toHaveLength(1));
    expect(campoPorRotulo("Descrição")).toHaveValue("PADARIA");
    expect(campoPorRotulo("Valor")).toHaveValue("12,50");
    expect(screen.queryByText(/lançamento salvo/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });

  it("erro com o checkbox desmarcado também não fecha o formulário", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, json: async () => ({ error: "ruim" }) };
      if (init?.method) return { ok: true, json: async () => ({ ok: true }) };
      if (url === "/api/categories") return { json: async () => categorias };
      return { json: async () => [tx()] };
    });
    render(<TransacoesPage />);
    await waitFor(() => screen.getByTestId("tabela"));
    fireEvent.click(screen.getByRole("button", { name: "+ Nova transação" }));

    lancar("PADARIA", "12,50");

    await waitFor(() => expect(lancamentosEnviados()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Salvar" })).toBeInTheDocument();
  });
});
