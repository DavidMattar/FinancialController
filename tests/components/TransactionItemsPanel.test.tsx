import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TransactionItemsPanel from "@/components/TransactionItemsPanel";
import { normalizarEspacos as norm } from "../helpers/text";

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * Configura o fetch com uma fila de respostas para as listagens (GET) — as
 * demais chamadas (POST/PATCH/DELETE) só respondem ok. Isso permite testar o
 * ciclo "cria item → recarrega lista".
 */
function comItens(...listas: unknown[][]) {
  const fila = [...listas];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init) {
      const proxima = fila.length > 1 ? fila.shift()! : fila[0];
      return { json: async () => proxima };
    }
    return { json: async () => ({ ok: true }) };
  });
}

const props = {
  transactionId: "tx-1",
  transactionAmount: 100,
  description: "SUPERMERCADO BH",
  hasCreditCard: false,
  pendingReturn: false,
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TransactionItemsPanel — listagem", () => {
  it("recarrega os itens quando a categoria da transação muda", async () => {
    // A categoria nova pode ter criado sub-itens fixos no servidor
    // (ensureFixedSubItems). O painel fica aberto durante a troca — a lista da
    // página é atualizada no lugar —, então quem tem de buscar de novo é ele.
    comItens([], [{ id: "i1", description: "Comida", amount: "0" }]);

    const { rerender } = render(<TransactionItemsPanel {...props} categoryId="cat-1" />);
    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));

    rerender(<TransactionItemsPanel {...props} categoryId="cat-viagem" />);

    await waitFor(() => expect(screen.getByText("Comida")).toBeInTheDocument());
  });

  it("não recarrega quando a categoria continua a mesma", async () => {
    comItens([]);

    const { rerender } = render(<TransactionItemsPanel {...props} categoryId="cat-1" />);
    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));
    const antes = fetchMock.mock.calls.length;

    rerender(<TransactionItemsPanel {...props} categoryId="cat-1" transactionAmount={200} />);

    expect(fetchMock.mock.calls.length).toBe(antes);
  });

  it("avisa que o detalhamento é apenas visual", async () => {
    comItens([]);
    render(<TransactionItemsPanel {...props} />);

    expect(
      screen.getByText(/apenas visual, não entra em relatórios ou métricas/),
    ).toBeInTheDocument();
  });

  it("mostra 'Carregando...' antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<TransactionItemsPanel {...props} />);

    expect(screen.getByText("Carregando...")).toBeInTheDocument();
  });

  it("busca os itens da transação informada", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1/items"),
    );
  });

  it("mostra aviso quando não há item", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() =>
      expect(screen.getByText("Nenhum item adicionado ainda.")).toBeInTheDocument(),
    );
  });

  it("lista os itens com descrição e valor", async () => {
    comItens([
      { id: "i1", description: "Arroz", amount: "25.90" },
      { id: "i2", description: "Banana", amount: "3.98" },
    ]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() => expect(screen.getByText("Arroz")).toBeInTheDocument());
    expect(norm(screen.getByText(/25,90/).textContent)).toBe(norm("R$ 25,90"));
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("recarrega quando muda a transação do painel", async () => {
    comItens([]);
    const { rerender } = render(<TransactionItemsPanel {...props} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(<TransactionItemsPanel {...props} transactionId="tx-2" />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-2/items"),
    );
  });
});

describe("TransactionItemsPanel — conferência da soma", () => {
  it("não mostra a soma quando não há item", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));
    expect(screen.queryByText(/Soma dos itens/)).not.toBeInTheDocument();
  });

  it("avisa que bate quando a soma é igual ao valor da transação", async () => {
    comItens([{ id: "i1", description: "Único", amount: "100.00" }]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() =>
      expect(screen.getByText(/bate com o valor da transação/)).toBeInTheDocument(),
    );
    expect(norm(screen.getByText(/Soma dos itens/).textContent)).toBe(
      norm("Soma dos itens: R$ 100,00"),
    );
  });

  it("mostra quanto falta quando a soma é menor", async () => {
    comItens([{ id: "i1", description: "Parcial", amount: "40.00" }]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() => expect(screen.getByText(/faltam/)).toBeInTheDocument());
    expect(norm(screen.getByText(/faltam/).textContent)).toContain(norm("faltam R$ 60,00"));
  });

  it("mostra quanto excede quando a soma é maior", async () => {
    comItens([{ id: "i1", description: "Exagerado", amount: "150.00" }]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() => expect(screen.getByText(/excede/)).toBeInTheDocument());
    expect(norm(screen.getByText(/excede/).textContent)).toContain(norm("excede R$ 50,00"));
  });

  it("tolera diferença de arredondamento abaixo de meio centavo", async () => {
    comItens([{ id: "i1", description: "Quase", amount: "99.999" }]);

    render(<TransactionItemsPanel {...props} />);

    await waitFor(() =>
      expect(screen.getByText(/bate com o valor da transação/)).toBeInTheDocument(),
    );
  });
});

describe("TransactionItemsPanel — adicionar item", () => {
  it("o botão fica desabilitado até preencher descrição e valor", async () => {
    comItens([]);
    render(<TransactionItemsPanel {...props} />);

    const botao = screen.getByRole("button", { name: "Adicionar" });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("ex: tomate"), { target: { value: "Tomate" } });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "5,50" } });
    expect(botao).not.toBeDisabled();
  });

  it("cria o item, aceita vírgula decimal e limpa o formulário", async () => {
    comItens([], [{ id: "i1", description: "Tomate", amount: "5.5" }]);
    render(<TransactionItemsPanel {...props} />);
    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));

    fireEvent.change(screen.getByPlaceholderText("ex: tomate"), { target: { value: "Tomate" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "5,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Tomate", amount: 5.5 }),
      }),
    );
    await waitFor(() =>
      expect(screen.getByPlaceholderText("ex: tomate")).toHaveValue(""),
    );
    expect(screen.getByPlaceholderText("0,00")).toHaveValue("");
  });

  it("avisa e não envia quando o valor não é um número", async () => {
    comItens([]);
    render(<TransactionItemsPanel {...props} />);

    fireEvent.change(screen.getByPlaceholderText("ex: tomate"), { target: { value: "X" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    expect(screen.getByText("Use vírgula ou ponto.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "POST")).toHaveLength(0);
  });

  it("aceita ponto decimal também", async () => {
    comItens([]);
    render(<TransactionItemsPanel {...props} />);

    fireEvent.change(screen.getByPlaceholderText("ex: tomate"), { target: { value: "X" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "12.34" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).amount).toBe(12.34);
    });
  });

  it("recarrega a lista depois de adicionar", async () => {
    comItens([], [{ id: "i1", description: "Tomate", amount: "5.5" }]);
    render(<TransactionItemsPanel {...props} />);
    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));

    fireEvent.change(screen.getByPlaceholderText("ex: tomate"), { target: { value: "Tomate" } });
    fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "5,50" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() => expect(screen.getByText("Tomate")).toBeInTheDocument());
  });

  it("não envia nada quando o formulário é submetido vazio", async () => {
    comItens([]);
    const { container } = render(<TransactionItemsPanel {...props} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.submit(container.querySelector("form")!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("TransactionItemsPanel — excluir item", () => {
  it("remove o item e recarrega", async () => {
    comItens([{ id: "i1", description: "Arroz", amount: "25.90" }], []);
    render(<TransactionItemsPanel {...props} />);
    await waitFor(() => screen.getByText("Arroz"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1/items/i1", {
        method: "DELETE",
      }),
    );
    await waitFor(() => expect(screen.getByText("Nenhum item adicionado ainda.")).toBeInTheDocument());
  });
});

describe("TransactionItemsPanel — pendência de devolução", () => {
  const propsEcommerce = { ...props, hasCreditCard: true, description: "SHOPEE 12345" };

  it("só oferece a opção em compra de e-commerce com cartão", async () => {
    comItens([]);

    const { rerender } = render(<TransactionItemsPanel {...props} />);
    await waitFor(() => screen.getByText("Nenhum item adicionado ainda."));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    // E-commerce, mas sem cartão: não oferece.
    rerender(<TransactionItemsPanel {...props} description="SHOPEE 12345" />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    // Cartão, mas não é e-commerce: não oferece.
    rerender(<TransactionItemsPanel {...props} hasCreditCard />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    // Os dois: oferece.
    rerender(<TransactionItemsPanel {...propsEcommerce} />);
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("reflete o valor inicial da pendência", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...propsEcommerce} pendingReturn />);

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
  });

  it("marcar avisa a API e o componente pai", async () => {
    comItens([]);
    const onPendingReturnChange = vi.fn();

    render(
      <TransactionItemsPanel {...propsEcommerce} onPendingReturnChange={onPendingReturnChange} />,
    );
    await waitFor(() => screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingReturn: true }),
      }),
    );
    await waitFor(() => expect(onPendingReturnChange).toHaveBeenCalledWith("tx-1", true));
  });

  it("desmarcar envia false", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...propsEcommerce} pendingReturn />);
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(JSON.parse(patch![1].body)).toEqual({ pendingReturn: false });
    });
  });

  it("funciona sem o callback do componente pai", async () => {
    comItens([]);

    render(<TransactionItemsPanel {...propsEcommerce} />);
    await waitFor(() => screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("checkbox"));

    await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
  });

  it("marca de imediato (otimista) e desabilita enquanto salva", async () => {
    let liberarPatch: () => void = () => {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        await new Promise<void>((resolve) => {
          liberarPatch = resolve;
        });
        return { json: async () => ({ ok: true }) };
      }
      return { json: async () => [] };
    });

    render(<TransactionItemsPanel {...propsEcommerce} />);
    await waitFor(() => screen.getByRole("checkbox"));

    fireEvent.click(screen.getByRole("checkbox"));

    // Já aparece marcado antes da resposta da API.
    expect(screen.getByRole("checkbox")).toBeChecked();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeDisabled());

    liberarPatch();
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeDisabled());
  });
});
