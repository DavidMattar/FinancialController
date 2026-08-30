import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * Os dois painéis de importação têm testes próprios (e fazem fetch ao montar);
 * aqui eles são dublês, porque o que a página faz é só alternar entre eles.
 */
vi.mock("@/components/InvoiceImportPanel", () => ({
  default: () => <div data-testid="painel-fatura">painel de fatura</div>,
}));
vi.mock("@/components/ReceiptImportPanel", () => ({
  default: () => <div data-testid="painel-nota">painel de nota fiscal</div>,
}));

import ImportarFaturaPage from "@/app/importar-fatura/page";

describe("página /importar-fatura", () => {
  it("mostra o título e as duas abas", () => {
    render(<ImportarFaturaPage />);

    expect(screen.getByRole("heading", { name: "Importar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fatura de Cartão" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nota Fiscal de Supermercado" })).toBeInTheDocument();
  });

  it("começa na aba de fatura de cartão", () => {
    render(<ImportarFaturaPage />);

    expect(screen.getByTestId("painel-fatura")).toBeInTheDocument();
    expect(screen.queryByTestId("painel-nota")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fatura de Cartão" }).className).toContain(
      "border-indigo-600",
    );
  });

  it("troca para a aba de nota fiscal", () => {
    render(<ImportarFaturaPage />);

    fireEvent.click(screen.getByRole("button", { name: "Nota Fiscal de Supermercado" }));

    expect(screen.getByTestId("painel-nota")).toBeInTheDocument();
    expect(screen.queryByTestId("painel-fatura")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nota Fiscal de Supermercado" }).className).toContain(
      "border-indigo-600",
    );
  });

  it("volta para a aba de fatura", () => {
    render(<ImportarFaturaPage />);

    fireEvent.click(screen.getByRole("button", { name: "Nota Fiscal de Supermercado" }));
    fireEvent.click(screen.getByRole("button", { name: "Fatura de Cartão" }));

    expect(screen.getByTestId("painel-fatura")).toBeInTheDocument();
  });

  it("a aba inativa não fica destacada", () => {
    render(<ImportarFaturaPage />);

    expect(screen.getByRole("button", { name: "Nota Fiscal de Supermercado" }).className).toContain(
      "border-transparent",
    );
  });
});
