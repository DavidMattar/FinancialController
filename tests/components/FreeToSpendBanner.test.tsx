import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import FreeToSpendBanner from "@/components/FreeToSpendBanner";
import { normalizarEspacos as norm } from "../helpers/text";

/** Resposta de GET /api/budget/summary. */
function resumo(over: Record<string, unknown> = {}) {
  return {
    periodFrom: "2026-08-01",
    periodTo: "2026-08-31",
    totalIncome: 10000,
    freeToSpend: { percent: 15, allocated: 1500, spent: 500, available: 1000 },
    tithe: { percent: 10, amount: 1000 },
    investment: { percent: 75, amount: 7500 },
    ...over,
  };
}

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

    const { container } = render(<FreeToSpendBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it("busca o resumo do orçamento do mês corrente", async () => {
    render(<FreeToSpendBanner />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/budget/summary"));
  });

  it("mostra o disponível para gastar formatado em reais", async () => {
    render(<FreeToSpendBanner />);

    await waitFor(() => {
      expect(norm(screen.getByText(/1\.000,00/).textContent)).toBe(norm("R$ 1.000,00"));
    });
  });

  it("mostra o mês de referência em português", async () => {
    render(<FreeToSpendBanner />);

    await waitFor(() => {
      expect(screen.getByText(/agosto de 2026/)).toBeInTheDocument();
    });
  });

  it("usa o dia 1º do período sem voltar um mês por causa de fuso", async () => {
    // 2026-01-01 interpretado como UTC viraria 31/12/2025 no Brasil.
    fetchMock.mockResolvedValue({
      json: async () => resumo({ periodFrom: "2026-01-01", periodTo: "2026-01-31" }),
    });

    render(<FreeToSpendBanner />);

    await waitFor(() => expect(screen.getByText(/janeiro de 2026/)).toBeInTheDocument());
  });

  it("mostra a receita do mês e a conta do 15%", async () => {
    render(<FreeToSpendBanner />);

    await waitFor(() => {
      expect(screen.getByText(/Receita do mês/)).toBeInTheDocument();
    });
    expect(norm(screen.getByText(/Receita do mês/).textContent)).toContain(norm("R$ 10.000,00"));
    const detalhe = norm(screen.getByText(/15% alocado/).textContent);
    expect(detalhe).toContain(norm("R$ 1.500,00"));
    expect(detalhe).toContain(norm("R$ 500,00"));
  });

  it("fica verde quando ainda há saldo disponível", async () => {
    const { container } = render(<FreeToSpendBanner />);

    await waitFor(() => expect(screen.getByText(/1\.000,00/)).toBeInTheDocument());
    expect(container.firstElementChild!.className).toContain("emerald");
    expect(container.firstElementChild!.className).not.toContain("red");
  });

  it("fica vermelho quando o disponível ficou negativo", async () => {
    fetchMock.mockResolvedValue({
      json: async () => resumo({ freeToSpend: { percent: 15, allocated: 150, spent: 500, available: -350 } }),
    });

    const { container } = render(<FreeToSpendBanner />);

    await waitFor(() => expect(screen.getByText(/350,00/)).toBeInTheDocument());
    expect(container.firstElementChild!.className).toContain("red");
    expect(norm(screen.getByText(/350,00/).textContent)).toBe(norm("-R$ 350,00"));
  });

  it("trata disponível exatamente zero como positivo (verde)", async () => {
    fetchMock.mockResolvedValue({
      json: async () => resumo({ freeToSpend: { percent: 15, allocated: 500, spent: 500, available: 0 } }),
    });

    const { container } = render(<FreeToSpendBanner />);

    // O valor grande é o "disponível"; buscar por texto pegaria também a
    // receita do mês, que contém "0,00" no meio de "R$ 10.000,00".
    await waitFor(() => expect(container.querySelector(".text-3xl")).toBeTruthy());
    expect(norm(container.querySelector(".text-3xl")!.textContent)).toBe(norm("R$ 0,00"));
    expect(container.firstElementChild!.className).toContain("emerald");
  });
});
