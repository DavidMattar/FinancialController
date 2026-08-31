import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const usePathname = vi.fn();
vi.mock("next/navigation", () => ({
  get usePathname() {
    return usePathname;
  },
}));

import Nav from "@/components/Nav";

beforeEach(() => {
  usePathname.mockReset();
  usePathname.mockReturnValue("/");
  document.documentElement.classList.remove("dark");
});

/** Todas as páginas que devem aparecer na barra. */
const PAGINAS: [string, string][] = [
  ["Dashboard", "/"],
  ["Transações", "/transacoes"],
  ["Transações Família", "/transacoes-familia"],
  ["Receitas", "/receitas"],
  ["Importar Fatura", "/importar-fatura"],
  ["Categorias", "/categorias"],
  ["Investimentos", "/investimentos"],
  ["Relatórios", "/relatorios"],
];

describe("Nav", () => {
  it("não repete o nome do app na barra", () => {
    // O nome vive no título da aba do navegador (metadata do layout raiz); na
    // barra ele só consumia a largura que as abas agora usam.
    render(<Nav />);
    expect(screen.queryByText(/Controle Financeiro/)).not.toBeInTheDocument();
  });

  it("distribui as abas na largura livre da barra", () => {
    render(<Nav />);

    const nav = screen.getByRole("navigation");
    expect(nav.className).toContain("flex-1");
    expect(nav.className).toContain("justify-between");
    // Continua rolando na horizontal quando a tela é estreita demais.
    expect(nav.className).toContain("overflow-x-auto");
  });

  it("mostra um link para cada página, com o href certo", () => {
    render(<Nav />);

    for (const [label, href] of PAGINAS) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
  });

  it("destaca o link da página atual", () => {
    usePathname.mockReturnValue("/transacoes");

    render(<Nav />);

    expect(screen.getByRole("link", { name: "Transações" }).className).toContain("bg-indigo-600");
    expect(screen.getByRole("link", { name: "Receitas" }).className).not.toContain("bg-indigo-600");
  });

  it("destaca o Dashboard na raiz", () => {
    usePathname.mockReturnValue("/");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Dashboard" }).className).toContain("bg-indigo-600");
  });

  it("não destaca nada numa rota que não está na barra", () => {
    usePathname.mockReturnValue("/rota-inexistente");

    render(<Nav />);

    for (const [label] of PAGINAS) {
      expect(screen.getByRole("link", { name: label }).className).not.toContain("bg-indigo-600");
    }
  });

  it("compara a rota por igualdade exata (subrota não destaca o pai)", () => {
    usePathname.mockReturnValue("/transacoes/123");
    render(<Nav />);
    expect(screen.getByRole("link", { name: "Transações" }).className).not.toContain(
      "bg-indigo-600",
    );
  });

  it("inclui o botão de alternar tema", () => {
    render(<Nav />);
    expect(screen.getByRole("button", { name: /tema/i })).toBeInTheDocument();
  });
});
