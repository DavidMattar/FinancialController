import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CategoriasPage from "@/app/categorias/page";
import { campoPorRotulo } from "../helpers/dom";

let fetchMock: ReturnType<typeof vi.fn>;

function categoria(over: Record<string, unknown> = {}) {
  return {
    id: "cat-1",
    name: "Alimentação",
    color: "#f97316",
    icon: "utensils",
    kind: "EXPENSE",
    keywords: ["IFOOD", "RESTAURANTE"],
    fixedSubItems: [],
    deductsFromFreeSpend: true,
    ...over,
  };
}

/**
 * GET devolve as listas em sequência (para testar recarga); POST/PATCH/DELETE
 * respondem conforme `escrita`.
 */
function comCategorias(listas: unknown[][], escrita?: { ok?: boolean; body?: unknown }) {
  const fila = [...listas];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method) {
      return { ok: escrita?.ok ?? true, json: async () => escrita?.body ?? { ok: true } };
    }
    const proxima = fila.length > 1 ? fila.shift()! : fila[0];
    return { ok: true, json: async () => proxima };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("página /categorias — listagem", () => {
  it("carrega e lista as categorias", async () => {
    comCategorias([[categoria(), categoria({ id: "cat-2", name: "Salário", kind: "INCOME", keywords: [] })]]);

    render(<CategoriasPage />);

    await waitFor(() => expect(screen.getByText("Alimentação")).toBeInTheDocument());
    expect(screen.getByText("Salário")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/categories");
  });

  it("mostra o tipo e as palavras-chave de cada categoria", async () => {
    comCategorias([[categoria()]]);

    render(<CategoriasPage />);

    await waitFor(() =>
      expect(screen.getByText(/Despesa · IFOOD, RESTAURANTE/)).toBeInTheDocument(),
    );
  });

  it("omite as palavras-chave quando não há nenhuma", async () => {
    comCategorias([[categoria({ keywords: [] })]]);

    render(<CategoriasPage />);

    await waitFor(() => expect(screen.getByText("Despesa")).toBeInTheDocument());
  });

  it("mostra 'Receita' para categoria de receita", async () => {
    comCategorias([[categoria({ kind: "INCOME", keywords: [] })]]);

    render(<CategoriasPage />);

    await waitFor(() => expect(screen.getByText("Receita")).toBeInTheDocument());
  });

  it("usa a cor da categoria no marcador", async () => {
    comCategorias([[categoria()]]);

    const { container } = render(<CategoriasPage />);

    await waitFor(() => screen.getByText("Alimentação"));
    const marcador = container.querySelector(".rounded-full") as HTMLElement;
    expect(marcador).toHaveStyle({ backgroundColor: "#f97316" });
  });

  it("mostra o cadeado e bloqueia a exclusão de categoria protegida", async () => {
    comCategorias([[categoria({ name: "Viagem", fixedSubItems: ["Comida", "Estadia"] })]]);

    render(<CategoriasPage />);

    await waitFor(() => expect(screen.getByText("🔒")).toBeInTheDocument());
    const botao = screen.getByRole("button", { name: "excluir" });
    expect(botao).toBeDisabled();
    expect(botao).toHaveAttribute("title", "Categoria protegida — não pode ser excluída");
  });

  it("categoria comum não tem cadeado e pode ser excluída", async () => {
    comCategorias([[categoria()]]);

    render(<CategoriasPage />);

    await waitFor(() => screen.getByText("Alimentação"));
    expect(screen.queryByText("🔒")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "excluir" })).not.toBeDisabled();
  });

  it("só categoria de despesa tem o toggle dos 15%", async () => {
    comCategorias([
      [categoria(), categoria({ id: "cat-2", name: "Salário", kind: "INCOME", keywords: [] })],
    ]);

    render(<CategoriasPage />);

    await waitFor(() => screen.getByText("Salário"));
    // Um na lista (despesa) + um no formulário de criação.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("página /categorias — criação", () => {
  it("cria a categoria com os dados do formulário", async () => {
    comCategorias([[]]);

    render(<CategoriasPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "Pets" } });
    fireEvent.change(campoPorRotulo("Palavras-chave"), { target: { value: "PETZ, COBASI" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pets",
          color: "#6366f1",
          kind: "EXPENSE",
          keywords: ["PETZ", "COBASI"],
          deductsFromFreeSpend: false,
        }),
      }),
    );
  });

  it("descarta palavras-chave vazias e espaços em volta", async () => {
    comCategorias([[]]);

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Palavras-chave"), { target: { value: " A , , B ,, " } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).keywords).toEqual(["A", "B"]);
    });
  });

  it("permite marcar o desconto dos 15% na criação", async () => {
    comCategorias([[]]);

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "Lazer" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).deductsFromFreeSpend).toBe(true);
    });
  });

  it("categoria de receita não tem o toggle dos 15% e grava sempre false", async () => {
    comCategorias([[]]);

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "Salário" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(campoPorRotulo("Tipo"), { target: { value: "INCOME" } });

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      const corpo = JSON.parse(post![1].body);
      expect(corpo.kind).toBe("INCOME");
      expect(corpo.deductsFromFreeSpend).toBe(false);
    });
  });

  it("permite escolher a cor", async () => {
    comCategorias([[]]);

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "X" } });
    fireEvent.change(campoPorRotulo("Cor"), { target: { value: "#ff0000" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).color).toBe("#ff0000");
    });
  });

  it("limpa o formulário e recarrega a lista depois de criar", async () => {
    comCategorias([[], [categoria({ name: "Pets" })]]);

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "Pets" } });
    fireEvent.change(campoPorRotulo("Palavras-chave"), { target: { value: "PETZ" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(campoPorRotulo("Nome")).toHaveValue(""));
    expect(campoPorRotulo("Palavras-chave")).toHaveValue("");
    await waitFor(() => expect(screen.getByText("Pets")).toBeInTheDocument());
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
      return { ok: true, json: async () => [] };
    });

    render(<CategoriasPage />);
    fireEvent.change(campoPorRotulo("Nome"), { target: { value: "X" } });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar" })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByRole("button", { name: "Adicionar" })).not.toBeDisabled());
  });
});

describe("página /categorias — toggle dos 15%", () => {
  it("atualiza a UI de imediato e salva no servidor", async () => {
    comCategorias([[categoria({ deductsFromFreeSpend: false })]]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));

    const toggleDaLista = screen.getAllByRole("checkbox")[1];
    fireEvent.click(toggleDaLista);

    // Atualização otimista: já marcado antes da resposta.
    expect(toggleDaLista).toBeChecked();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/categories/cat-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deductsFromFreeSpend: true }),
      }),
    );
  });

  it("desmarcar envia false", async () => {
    comCategorias([[categoria({ deductsFromFreeSpend: true })]]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));

    fireEvent.click(screen.getAllByRole("checkbox")[1]);

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(JSON.parse(patch![1].body)).toEqual({ deductsFromFreeSpend: false });
    });
  });

  it("trata flag ausente como desmarcada", async () => {
    comCategorias([[categoria({ deductsFromFreeSpend: undefined })]]);

    render(<CategoriasPage />);

    await waitFor(() => expect(screen.getAllByRole("checkbox")[1]).not.toBeChecked());
  });
});

describe("página /categorias — exclusão", () => {
  it("pede confirmação nomeando a categoria", async () => {
    comCategorias([[categoria()]]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(screen.getByText("Excluir categoria")).toBeInTheDocument();
    expect(screen.getByText(/Excluir "Alimentação"\?/)).toBeInTheDocument();
    expect(screen.getByText(/ficarão sem categoria/)).toBeInTheDocument();
  });

  it("confirmar exclui e recarrega", async () => {
    comCategorias([[categoria()], []]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/categories/cat-1", { method: "DELETE" }),
    );
    await waitFor(() => expect(screen.queryByText("Alimentação")).not.toBeInTheDocument());
  });

  it("cancelar não exclui", async () => {
    comCategorias([[categoria()]]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByText("Excluir categoria")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "DELETE")).toHaveLength(0);
  });

  it("mostra o motivo quando o servidor recusa a exclusão", async () => {
    comCategorias([[categoria()]], {
      ok: false,
      body: { error: 'A categoria "Viagem" tem uma regra de negócio associada.' },
    });

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() => expect(screen.getByText("Não foi possível excluir")).toBeInTheDocument());
    expect(screen.getByText(/regra de negócio associada/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));

    await waitFor(() =>
      expect(screen.queryByText("Não foi possível excluir")).not.toBeInTheDocument(),
    );
  });

  it("usa mensagem genérica quando o servidor recusa sem detalhar", async () => {
    comCategorias([[categoria()]], { ok: false, body: {} });

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));

    await waitFor(() =>
      expect(screen.getByText("Não foi possível excluir esta categoria.")).toBeInTheDocument(),
    );
  });

  it("o aviso de erro pode ser fechado pelo cancelar", async () => {
    comCategorias([[categoria()]], { ok: false, body: { error: "não pode" } });

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Alimentação"));
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));
    fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => screen.getByText("Não foi possível excluir"));

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByText("Não foi possível excluir")).not.toBeInTheDocument(),
    );
  });
});

describe("página /categorias — casos de borda da lista", () => {
  it("o toggle dos 15% altera só a categoria clicada", async () => {
    comCategorias([
      [
        categoria({ id: "cat-1", name: "Alimentação", deductsFromFreeSpend: false }),
        categoria({ id: "cat-2", name: "Lazer", deductsFromFreeSpend: false }),
      ],
    ]);

    render(<CategoriasPage />);
    await waitFor(() => screen.getByText("Lazer"));

    // Índice 0 é o toggle do formulário; 1 e 2 são os da lista.
    const togglesDaLista = screen.getAllByRole("checkbox").slice(1);
    fireEvent.click(togglesDaLista[0]);

    expect(togglesDaLista[0]).toBeChecked();
    expect(togglesDaLista[1]).not.toBeChecked();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/categories/cat-1", expect.anything()),
    );
  });

  it("categoria sem o campo de sub-itens fixos não é tratada como protegida", async () => {
    // Registro antigo/serializado sem a chave `fixedSubItems`.
    const semCampo = { ...categoria() } as Record<string, unknown>;
    delete semCampo.fixedSubItems;
    comCategorias([[semCampo]]);

    render(<CategoriasPage />);

    await waitFor(() => screen.getByText("Alimentação"));
    expect(screen.queryByText("🔒")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "excluir" })).not.toBeDisabled();
  });
});
