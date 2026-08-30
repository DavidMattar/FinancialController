import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { normalizarEspacos as norm } from "../helpers/text";

vi.mock("@/components/CategoryPieChart", () => ({
  default: ({ data }: any) => <div data-testid="pizza">{data.length} fatias</div>,
}));
vi.mock("@/components/BackupPanel", () => ({
  default: () => <div data-testid="painel-backup">backup</div>,
}));

import RelatoriosPage from "@/app/relatorios/page";

let fetchMock: ReturnType<typeof vi.fn>;

const categorias = [
  { id: "cat-1", name: "Supermercado", color: "#22c55e", icon: "cart", kind: "EXPENSE", keywords: [] },
  { id: "cat-2", name: "Transporte", color: "#3b82f6", icon: "car", kind: "EXPENSE", keywords: [] },
];

const metricas = {
  totalExpense: 1500,
  transactionCount: 12,
  averageTicket: 125,
  byCategory: [{ name: "Supermercado", color: "#22c55e", total: 800 }],
};

function comDados() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/categories") return { json: async () => categorias };
    if (url.startsWith("/api/transactions/metrics")) return { json: async () => metricas };
    throw new Error(`rota inesperada: ${url}`);
  });
}

/**
 * Texto do contador de categorias. O JSX quebra "(N de M)" em vários nós de
 * texto, então buscar por texto solto não encontra nada.
 */
function contador(): string {
  const p = Array.from(document.querySelectorAll("p")).find((el) =>
    el.textContent?.startsWith("Categorias no relatório"),
  );
  return p?.textContent ?? "";
}

/** Última URL de métricas consultada. */
function ultimaUrlDeMetricas(): string {
  const chamadas = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("/api/transactions/metrics"));
  return String(chamadas.at(-1)?.[0] ?? "");
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

describe("página /relatorios — filtros", () => {
  it("carrega as categorias e começa com todas marcadas", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(contador()).toContain("(3 de 3)"));
    for (const caixa of screen.getAllByRole("checkbox")) expect(caixa).toBeChecked();
  });

  it("inclui o pseudo-filtro 'Sem categoria'", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(screen.getByText("Sem categoria")).toBeInTheDocument());
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("busca as métricas do mês corrente com todas as categorias", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(ultimaUrlDeMetricas()).toContain("from=2026-08-01"));
    const url = ultimaUrlDeMetricas();
    expect(url).toContain("to=2026-08-31");
    expect(decodeURIComponent(url)).toContain("categoryIds=cat-1,cat-2,none");
  });

  it("desmarcar uma categoria refaz a busca sem ela", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() =>
      expect(decodeURIComponent(ultimaUrlDeMetricas())).toContain("categoryIds=cat-2,none"),
    );
    expect(contador()).toContain("(2 de 3)");
  });

  it("remarcar volta a incluir a categoria", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() => expect(contador()).toContain("(2 de 3)"));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(contador()).toContain("(3 de 3)"));
  });

  it("'Limpar seleção' desmarca tudo e 'Selecionar todas' volta", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    fireEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));

    await waitFor(() => expect(contador()).toContain("(0 de 3)"));
    expect(screen.getByRole("button", { name: "Limpar seleção" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Selecionar todas" }));

    await waitFor(() => expect(contador()).toContain("(3 de 3)"));
  });

  it("'Selecionar todas' fica desabilitado quando já está tudo marcado", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(contador()).toContain("(3 de 3)"));
    // Com 2 categorias + "none" = 3 selecionáveis, mas o estado inicial marca
    // todas — o botão só habilita depois de desmarcar alguma.
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Selecionar todas" })).not.toBeDisabled(),
    );
  });

  it("trocar o período refaz a busca", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    fireEvent.click(screen.getByRole("button", { name: "Este ano" }));

    await waitFor(() => expect(ultimaUrlDeMetricas()).toContain("from=2026-01-01"));
  });
});

describe("página /relatorios — resultados", () => {
  it("mostra os três totais do período", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(screen.getByText("Total no período")).toBeInTheDocument());
    expect(screen.getByText("Transações")).toBeInTheDocument();
    expect(screen.getByText("Ticket médio")).toBeInTheDocument();
    const texto = norm(document.body.textContent);
    expect(texto).toContain(norm("R$ 1.500,00"));
    expect(texto).toContain(norm("R$ 125,00"));
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("mostra o gráfico de pizza com as fatias devolvidas", async () => {
    comDados();

    render(<RelatoriosPage />);

    await waitFor(() => expect(screen.getByTestId("pizza")).toHaveTextContent("1 fatias"));
  });

  it("não mostra os totais antes da resposta", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    render(<RelatoriosPage />);

    expect(screen.queryByText("Total no período")).not.toBeInTheDocument();
  });
});

describe("página /relatorios — exportação e backup", () => {
  it("o link de CSV leva os mesmos filtros da tela", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    const link = screen.getByRole("link", { name: "Exportar CSV" });
    const href = decodeURIComponent(link.getAttribute("href")!);
    expect(href).toContain("from=2026-08-01");
    expect(href).toContain("to=2026-08-31");
    expect(href).toContain("categoryIds=cat-1,cat-2,none");
  });

  it("o link de CSV acompanha a desmarcação de categorias", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => {
      const href = decodeURIComponent(
        screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href")!,
      );
      expect(href).toContain("categoryIds=cat-2,none");
    });
  });

  it("mostra o bloco de backup no fim da página", async () => {
    comDados();

    render(<RelatoriosPage />);

    expect(screen.getByTestId("painel-backup")).toBeInTheDocument();
  });
});

describe("página /relatorios — filtro 'Sem categoria'", () => {
  it("desmarcar 'Sem categoria' tira o pseudo-id da busca", async () => {
    comDados();

    render(<RelatoriosPage />);
    await waitFor(() => expect(contador()).toContain("(3 de 3)"));

    // O checkbox de "Sem categoria" é o último da lista.
    const caixas = screen.getAllByRole("checkbox");
    fireEvent.click(caixas[caixas.length - 1]);

    await waitFor(() =>
      expect(decodeURIComponent(ultimaUrlDeMetricas())).toContain("categoryIds=cat-1,cat-2"),
    );
    expect(decodeURIComponent(ultimaUrlDeMetricas())).not.toContain("none");
    expect(contador()).toContain("(2 de 3)");
  });
});
