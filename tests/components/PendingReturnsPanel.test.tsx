import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PendingReturnsPanel from "@/components/PendingReturnsPanel";
import { normalizarEspacos as norm } from "../helpers/text";

let fetchMock: ReturnType<typeof vi.fn>;

/** Configura o fetch: a 1ª chamada é a listagem; as demais são o PATCH. */
function comPendencias(itens: unknown[]) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!init) return { json: async () => itens };
    return { json: async () => ({ ok: true }) };
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pendencia = {
  id: "tx-1",
  date: "2026-08-15",
  description: "SHOPEE 12345",
  amount: "150.00",
};

describe("PendingReturnsPanel", () => {
  it("não renderiza nada enquanto carrega", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<PendingReturnsPanel />);

    expect(container).toBeEmptyDOMElement();
  });

  it("busca as pendências ignorando qualquer filtro de período", async () => {
    comPendencias([]);

    render(<PendingReturnsPanel />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions?pendingReturn=true"),
    );
  });

  it("mostra o aviso discreto quando não há pendência", async () => {
    comPendencias([]);

    render(<PendingReturnsPanel />);

    await waitFor(() =>
      expect(screen.getByText(/nenhum item pendente de devolução/)).toBeInTheDocument(),
    );
  });

  it("lista as pendências com data, descrição e valor", async () => {
    comPendencias([pendencia]);

    render(<PendingReturnsPanel />);

    await waitFor(() => expect(screen.getByText(/SHOPEE 12345/)).toBeInTheDocument());
    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument();
    expect(norm(screen.getByText(/150,00/).textContent)).toBe(norm("R$ 150,00"));
  });

  it("mostra a contagem de pendências no título", async () => {
    comPendencias([pendencia, { ...pendencia, id: "tx-2" }]);

    render(<PendingReturnsPanel />);

    await waitFor(() => expect(screen.getByText(/Pendente de verificação \(2\)/)).toBeInTheDocument());
  });

  it("resolver uma pendência avisa a API e remove da lista", async () => {
    comPendencias([pendencia, { ...pendencia, id: "tx-2", description: "AMAZON" }]);

    render(<PendingReturnsPanel />);
    await waitFor(() => expect(screen.getByText(/SHOPEE 12345/)).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "resolver" })[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/transactions/tx-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingReturn: false }),
      }),
    );
    await waitFor(() => expect(screen.queryByText(/SHOPEE 12345/)).not.toBeInTheDocument());
    // A outra pendência continua na lista.
    expect(screen.getByText(/AMAZON/)).toBeInTheDocument();
  });

  it("resolver a última pendência mostra o estado vazio", async () => {
    comPendencias([pendencia]);

    render(<PendingReturnsPanel />);
    await waitFor(() => expect(screen.getByText(/SHOPEE 12345/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "resolver" }));

    await waitFor(() =>
      expect(screen.getByText(/nenhum item pendente de devolução/)).toBeInTheDocument(),
    );
  });

  it("o botão de resolver tem título explicativo", async () => {
    comPendencias([pendencia]);

    render(<PendingReturnsPanel />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "resolver" })).toHaveAttribute(
        "title",
        "Marcar como resolvido",
      ),
    );
  });
});
