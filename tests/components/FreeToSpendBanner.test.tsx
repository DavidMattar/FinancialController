import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FreeToSpendBanner from "@/components/FreeToSpendBanner";
import { normalizarEspacos as norm } from "../helpers/text";

/**
 * O banner mostra a fatia dos 15% do PERÍODO selecionado no dashboard. Com um
 * mês só ele é o de sempre; com vários, o número grande é o acumulado do
 * período e um detalhamento recolhido mostra o caminho mês a mês (ver
 * `src/lib/budget.ts`).
 */

/** Uma linha do detalhamento mês a mês, como a rota devolve. */
function mes(month: string, income: number, spent: number, cumulativeAvailable: number) {
  const allocated = income * 0.15;
  return { month, income, allocated, spent, monthAvailable: allocated - spent, cumulativeAvailable };
}

/** Resposta de GET /api/budget/summary para um mês só. */
function resumo(over: Record<string, unknown> = {}) {
  return {
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    totalIncome: 10000,
    freeToSpend: { percent: 15, allocated: 1500, spent: 500, available: 1000 },
    tithe: { percent: 10, amount: 1000 },
    investment: { percent: 75, amount: 7500 },
    months: [mes("2026-08", 10000, 500, 1000)],
    ...over,
  };
}

/**
 * Resposta de três meses do exemplo que definiu a regra: R$ 100/mês de receita
 * (15% = R$ 15) com R$ 32 gastos no primeiro mês — acumulado −17, −2 e +13.
 */
function resumoTresMeses(over: Record<string, unknown> = {}) {
  return resumo({
    periodFrom: "2026-06-01",
    periodTo: "2026-08-31",
    totalIncome: 300,
    freeToSpend: { percent: 15, allocated: 45, spent: 32, available: 13 },
    months: [mes("2026-06", 100, 32, -17), mes("2026-07", 100, 0, -2), mes("2026-08", 100, 0, 13)],
    ...over,
  });
}

const MES_ATUAL = { from: "2026-08-01", to: "2026-08-31" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ json: async () => resumo() });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FreeToSpendBanner", () => {
  it("não renderiza nada enquanto o resumo não chega", () => {
    // Promessa que nunca resolve: simula a requisição em andamento.
    fetchMock.mockReturnValue(new Promise(() => {}));

    const { container } = render(<FreeToSpendBanner range={MES_ATUAL} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("busca o resumo do orçamento do período recebido", async () => {
    render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/budget/summary?from=2026-06-01&to=2026-08-31"),
    );
  });

  it("rebusca quando o período muda", async () => {
    const { rerender } = render(<FreeToSpendBanner range={MES_ATUAL} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValue({ json: async () => resumoTresMeses() });
    rerender(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith("/api/budget/summary?from=2026-06-01&to=2026-08-31"),
    );
    await waitFor(() => expect(screen.getByText(/junho de 2026 a agosto de 2026/)).toBeInTheDocument());
  });

  it("não rebusca quando o período recebido é o mesmo (objeto novo, datas iguais)", async () => {
    const { rerender } = render(<FreeToSpendBanner range={MES_ATUAL} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(<FreeToSpendBanner range={{ from: "2026-08-01", to: "2026-08-31" }} />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("mostra o disponível para gastar formatado em reais", async () => {
    render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => {
      expect(norm(screen.getByText(/1\.000,00/).textContent)).toBe(norm("R$ 1.000,00"));
    });
  });

  it("mostra o mês de referência em português quando o período é um mês só", async () => {
    render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => {
      expect(screen.getByText(/agosto de 2026/)).toBeInTheDocument();
    });
  });

  it("usa o dia 1º do período sem voltar um mês por causa de fuso", async () => {
    // 2026-01-01 interpretado como UTC viraria 31/12/2025 no Brasil.
    fetchMock.mockResolvedValue({
      json: async () => resumo({ periodFrom: "2026-01-01", periodTo: "2026-01-31" }),
    });

    render(<FreeToSpendBanner range={{ from: "2026-01-01", to: "2026-01-31" }} />);

    await waitFor(() => expect(screen.getByText(/janeiro de 2026/)).toBeInTheDocument());
  });

  it("mostra a receita do mês e a conta do 15%", async () => {
    render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => {
      expect(screen.getByText(/Receita do mês/)).toBeInTheDocument();
    });
    expect(norm(screen.getByText(/Receita do mês/).textContent)).toContain(norm("R$ 10.000,00"));
    const detalhe = norm(screen.getByText(/15% alocado/).textContent);
    expect(detalhe).toContain(norm("R$ 1.500,00"));
    expect(detalhe).toContain(norm("R$ 500,00"));
  });

  it("não mostra detalhamento mês a mês quando o período é um mês só", async () => {
    render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => expect(screen.getByText(/agosto de 2026/)).toBeInTheDocument());
    expect(screen.queryByText(/Acúmulo mês a mês/)).not.toBeInTheDocument();
  });

  it("fica verde quando ainda há saldo disponível", async () => {
    const { container } = render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => expect(screen.getByText(/1\.000,00/)).toBeInTheDocument());
    expect(container.firstElementChild!.className).toContain("emerald");
    expect(container.firstElementChild!.className).not.toContain("red");
  });

  it("fica vermelho quando o disponível ficou negativo", async () => {
    fetchMock.mockResolvedValue({
      json: async () =>
        resumo({
          freeToSpend: { percent: 15, allocated: 150, spent: 500, available: -350 },
          months: [mes("2026-08", 1000, 500, -350)],
        }),
    });

    const { container } = render(<FreeToSpendBanner range={MES_ATUAL} />);

    await waitFor(() => expect(screen.getByText(/350,00/)).toBeInTheDocument());
    expect(container.firstElementChild!.className).toContain("red");
    expect(norm(screen.getByText(/350,00/).textContent)).toBe(norm("-R$ 350,00"));
  });

  it("trata disponível exatamente zero como positivo (verde)", async () => {
    fetchMock.mockResolvedValue({
      json: async () =>
        resumo({
          freeToSpend: { percent: 15, allocated: 500, spent: 500, available: 0 },
          months: [mes("2026-08", 3333.33, 500, 0)],
        }),
    });

    const { container } = render(<FreeToSpendBanner range={MES_ATUAL} />);

    // O valor grande é o "disponível"; buscar por texto pegaria também a
    // receita do mês, que contém "0,00" no meio de "R$ 10.000,00".
    await waitFor(() => expect(container.querySelector(".text-3xl")).toBeTruthy());
    expect(norm(container.querySelector(".text-3xl")!.textContent)).toBe(norm("R$ 0,00"));
    expect(container.firstElementChild!.className).toContain("emerald");
  });
});

describe("FreeToSpendBanner — período de vários meses", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue({ json: async () => resumoTresMeses() });
  });

  it("descreve o período pelos meses das pontas", async () => {
    render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() => expect(screen.getByText(/junho de 2026 a agosto de 2026/)).toBeInTheDocument());
  });

  it("mostra o acumulado do período como valor principal", async () => {
    const { container } = render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() => expect(container.querySelector(".text-3xl")).toBeTruthy());
    expect(norm(container.querySelector(".text-3xl")!.textContent)).toBe(norm("R$ 13,00"));
    expect(screen.getByText(/Acumulado dos 3 meses do período/)).toBeInTheDocument();
  });

  it("fala de 'receita do período', não 'do mês'", async () => {
    render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() => expect(screen.getByText(/Receita do período/)).toBeInTheDocument());
    expect(screen.queryByText(/Receita do mês/)).not.toBeInTheDocument();
  });

  it("lista o acúmulo de cada mês do período", async () => {
    render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() => expect(screen.getByText(/Acúmulo mês a mês \(3 meses\)/)).toBeInTheDocument());
    const linhas = document.querySelectorAll("details li");
    expect(linhas).toHaveLength(3);
    // Junho: 15% de 100 = 15 alocados contra 32 gastos → acumulado -17.
    expect(norm(linhas[0].textContent)).toContain(norm("junho de 2026"));
    expect(norm(linhas[0].textContent)).toContain(norm("-R$ 17,00"));
    // Julho sem gasto: o estouro de junho ainda deixa o acumulado negativo.
    expect(norm(linhas[1].textContent)).toContain(norm("-R$ 2,00"));
    // Agosto sem gasto: o acumulado volta a ficar positivo.
    expect(norm(linhas[2].textContent)).toContain(norm("R$ 13,00"));
  });

  it("pinta de vermelho só os meses em que o acumulado está negativo", async () => {
    render(<FreeToSpendBanner range={{ from: "2026-06-01", to: "2026-08-31" }} />);

    await waitFor(() => expect(document.querySelectorAll("details li")).toHaveLength(3));
    const acumulados = Array.from(document.querySelectorAll("details li")).map(
      (li) => li.lastElementChild!.className,
    );
    expect(acumulados[0]).toContain("red");
    expect(acumulados[1]).toContain("red");
    expect(acumulados[2]).toContain("emerald");
  });

  it("mostra as datas (não o nome do mês) quando o período corta o mês no meio", async () => {
    fetchMock.mockResolvedValue({
      json: async () => resumoTresMeses({ periodFrom: "2026-06-10", periodTo: "2026-08-20" }),
    });

    render(<FreeToSpendBanner range={{ from: "2026-06-10", to: "2026-08-20" }} />);

    await waitFor(() => expect(screen.getByText(/10\/06\/2026 a 20\/08\/2026/)).toBeInTheDocument());
  });
});
