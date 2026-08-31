import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

// A rota atual é o que decide o arquivo de log da navegação.
const pathname = vi.hoisted(() => ({ atual: "/transacoes" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.atual }));

import ActivityLogger from "@/components/ActivityLogger";
import ErrorPopupProvider from "@/components/ErrorPopupProvider";
import { LOG_ENDPOINT, resetNavigationMemory } from "@/lib/logClient";

let baseFetch: ReturnType<typeof vi.fn>;

/** Eventos enviados para a rota de log. */
function eventos(): Record<string, unknown>[] {
  return baseFetch.mock.calls
    .filter((c) => c[0] === LOG_ENDPOINT)
    .flatMap((c) => JSON.parse(String(c[1].body)).events as Record<string, unknown>[]);
}

beforeEach(() => {
  baseFetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  window.fetch = baseFetch as unknown as typeof fetch;
  pathname.atual = "/transacoes";
  resetNavigationMemory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ActivityLogger", () => {
  it("não renderiza nada na tela", () => {
    const { container } = render(<ActivityLogger />);

    expect(container).toBeEmptyDOMElement();
  });

  it("registra a aba aberta já na primeira carga", async () => {
    render(<ActivityLogger />);

    await vi.waitFor(() => expect(eventos()).toHaveLength(1));
    expect(eventos()[0]).toMatchObject({
      action: "navegou",
      tab: "transacoes",
      level: "info",
    });
  });

  it("troca o fetch global enquanto está montado, e devolve ao desmontar", () => {
    const { unmount } = render(<ActivityLogger />);

    expect(window.fetch).not.toBe(baseFetch);

    unmount();

    expect(window.fetch).toBe(baseFetch);
  });

  it("passa a registrar as escritas depois de montado", async () => {
    render(<ActivityLogger />);
    await vi.waitFor(() => expect(eventos()).toHaveLength(1));

    await window.fetch("/api/transactions", { method: "POST" });

    await vi.waitFor(() => expect(eventos()).toHaveLength(2));
    expect(eventos()[1]).toMatchObject({ action: "gravou" });
  });

  it("registra a troca de aba", async () => {
    const { rerender } = render(<ActivityLogger />);
    await vi.waitFor(() => expect(eventos()).toHaveLength(1));

    pathname.atual = "/investimentos";
    rerender(<ActivityLogger />);

    await vi.waitFor(() => expect(eventos()).toHaveLength(2));
    expect(eventos()[1]).toMatchObject({ tab: "investimentos", action: "navegou" });
  });

  it("dentro do provider, um erro de API abre o pop-up", async () => {
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 500, clone: () => ({ text: async () => "" }) },
    );

    render(
      <ErrorPopupProvider>
        <ActivityLogger />
      </ErrorPopupProvider>,
    );

    await window.fetch("/api/transactions", { method: "POST" });

    await vi.waitFor(() =>
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
        "Erro no servidor",
      ),
    );
  });
});
