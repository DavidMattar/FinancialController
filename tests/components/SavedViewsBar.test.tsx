import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SavedViewsBar from "@/components/SavedViewsBar";

let fetchMock: ReturnType<typeof vi.fn>;
const periodoAtual = { from: "2026-08-01", to: "2026-08-31" };

const vistas = [
  { id: "view-1", name: "Q1 2026", filters: { from: "2026-01-01", to: "2026-03-31" } },
  { id: "view-2", name: "Ano todo", filters: { from: "2026-01-01", to: "2026-12-31" } },
];

/** GET /api/views devolve `lista`; POST e DELETE respondem ok. */
function comVistas(lista: unknown[]) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) return { json: async () => lista };
    return { json: async () => ({ ok: true }) };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("prompt", vi.fn());
  vi.stubGlobal("confirm", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SavedViewsBar", () => {
  it("carrega e lista as visões salvas", async () => {
    comVistas(vistas);

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Q1 2026" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Ano todo" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/views");
  });

  it("mostra o rótulo e o botão de salvar mesmo sem nenhuma visão", async () => {
    comVistas([]);

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);

    expect(screen.getByText("Visões salvas:")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ salvar período atual" })).toBeInTheDocument();
  });

  it("clicar numa visão aplica o período dela", async () => {
    comVistas(vistas);
    const onApply = vi.fn();

    render(<SavedViewsBar currentRange={periodoAtual} onApply={onApply} />);
    await waitFor(() => screen.getByRole("button", { name: "Q1 2026" }));

    fireEvent.click(screen.getByRole("button", { name: "Q1 2026" }));

    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-03-31" });
  });

  it("salva o período atual com o nome digitado e recarrega a lista", async () => {
    comVistas([]);
    vi.mocked(window.prompt).mockReturnValue("Meu período");

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "+ salvar período atual" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Meu período", filters: periodoAtual }),
      }),
    );
    // Recarrega depois de salvar: GET inicial + POST + GET.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("não salva nada se o usuário cancelar o prompt", async () => {
    comVistas([]);
    vi.mocked(window.prompt).mockReturnValue(null);

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "+ salvar período atual" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não salva nada se o nome vier vazio", async () => {
    comVistas([]);
    vi.mocked(window.prompt).mockReturnValue("");

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "+ salvar período atual" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("remove uma visão depois de confirmar", async () => {
    comVistas(vistas);
    vi.mocked(window.confirm).mockReturnValue(true);

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: "Q1 2026" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/views/view-1", { method: "DELETE" }),
    );
  });

  it("não remove nada se o usuário cancelar a confirmação", async () => {
    comVistas(vistas);
    vi.mocked(window.confirm).mockReturnValue(false);

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    await waitFor(() => screen.getByRole("button", { name: "Q1 2026" }));
    const chamadasAntes = fetchMock.mock.calls.length;

    fireEvent.click(screen.getAllByRole("button", { name: "Remover" })[0]);

    expect(fetchMock).toHaveBeenCalledTimes(chamadasAntes);
  });

  it("desabilita o botão de salvar enquanto a requisição está em andamento", async () => {
    comVistas([]);
    vi.mocked(window.prompt).mockReturnValue("Nome");
    // POST que só resolve quando o teste quiser.
    let liberarPost: () => void = () => {};
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        await new Promise<void>((resolve) => {
          liberarPost = resolve;
        });
        return { json: async () => ({ ok: true }) };
      }
      return { json: async () => [] };
    });

    render(<SavedViewsBar currentRange={periodoAtual} onApply={vi.fn()} />);
    const botao = screen.getByRole("button", { name: "+ salvar período atual" });

    fireEvent.click(botao);

    await waitFor(() => expect(botao).toBeDisabled());
    liberarPost();
    await waitFor(() => expect(botao).not.toBeDisabled());
  });
});
