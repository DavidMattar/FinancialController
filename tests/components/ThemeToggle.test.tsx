import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * A fonte de verdade do tema é a classe `dark` no `<html>` (o Tailwind v4 usa
 * ela), não o estado do React — por isso os testes verificam sempre o DOM e o
 * localStorage, não só o ícone.
 */
beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("ThemeToggle", () => {
  it("mostra a lua quando o tema está claro", () => {
    render(<ThemeToggle />);

    const botao = screen.getByRole("button");
    expect(botao).toHaveTextContent("🌙");
    expect(botao).toHaveAttribute("aria-label", "Mudar para tema escuro");
  });

  it("sincroniza com o tema já aplicado na página ao montar", () => {
    // O layout aplica a classe antes do React carregar, para evitar flash.
    document.documentElement.classList.add("dark");

    render(<ThemeToggle />);

    const botao = screen.getByRole("button");
    expect(botao).toHaveTextContent("☀️");
    expect(botao).toHaveAttribute("aria-label", "Mudar para tema claro");
  });

  it("liga o tema escuro no clique", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button")).toHaveTextContent("☀️");
  });

  it("desliga o tema escuro no segundo clique", () => {
    render(<ThemeToggle />);
    const botao = screen.getByRole("button");

    fireEvent.click(botao);
    fireEvent.click(botao);

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(botao).toHaveTextContent("🌙");
  });

  it("salva a escolha no localStorage para a próxima visita", () => {
    render(<ThemeToggle />);
    const botao = screen.getByRole("button");

    fireEvent.click(botao);
    expect(localStorage.getItem("theme")).toBe("dark");

    fireEvent.click(botao);
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("tem título acessível junto com o aria-label", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveAttribute("title", "Mudar para tema escuro");
  });
});
