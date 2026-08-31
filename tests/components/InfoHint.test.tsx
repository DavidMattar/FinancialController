import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import InfoHint from "@/components/InfoHint";

/** O botão "?" de uma dica, achado pelo nome acessível. */
function botao(label: string) {
  return screen.getByRole("button", { name: `ajuda sobre ${label}` });
}

describe("InfoHint", () => {
  it("mostra só o '?' antes de qualquer interação", () => {
    render(<InfoHint label="Quantidade">Quantas unidades do ativo.</InfoHint>);

    expect(botao("Quantidade")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("abre a dica ao passar o mouse e fecha ao tirar", () => {
    render(<InfoHint label="Quantidade">Quantas unidades do ativo.</InfoHint>);

    fireEvent.mouseEnter(botao("Quantidade"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Quantas unidades do ativo.");

    fireEvent.mouseLeave(botao("Quantidade"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("abre pelo foco do teclado e fecha ao sair dele", () => {
    // Quem navega por teclado não "passa o mouse"; sem isto a dica seria
    // inacessível para essa pessoa.
    render(<InfoHint label="Quantidade">Texto.</InfoHint>);

    fireEvent.focus(botao("Quantidade"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.blur(botao("Quantidade"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("alterna no clique (é o caminho de quem usa tela de toque)", () => {
    render(<InfoHint label="Quantidade">Texto.</InfoHint>);

    fireEvent.click(botao("Quantidade"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.click(botao("Quantidade"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("liga o botão à dica por aria-describedby só enquanto ela está aberta", () => {
    render(<InfoHint label="Quantidade">Texto.</InfoHint>);

    expect(botao("Quantidade")).not.toHaveAttribute("aria-describedby");
    expect(botao("Quantidade")).toHaveAttribute("aria-expanded", "false");

    fireEvent.mouseEnter(botao("Quantidade"));

    expect(botao("Quantidade")).toHaveAttribute("aria-expanded", "true");
    expect(botao("Quantidade").getAttribute("aria-describedby")).toBe(
      screen.getByRole("tooltip").getAttribute("id"),
    );
  });

  it("preserva as quebras de linha do texto da dica", () => {
    // As dicas explicam com exemplo em linha separada; sem isso viraria um
    // parágrafo corrido.
    render(<InfoHint label="Preço">{"Primeira linha.\nSegunda linha."}</InfoHint>);

    fireEvent.mouseEnter(botao("Preço"));

    const dica = screen.getByRole("tooltip");
    expect(dica.className).toContain("whitespace-pre-line");
    expect(dica.textContent).toBe("Primeira linha.\nSegunda linha.");
  });

  it("duas dicas na mesma tela são independentes", () => {
    render(
      <>
        <InfoHint label="Quantidade">Dica da quantidade.</InfoHint>
        <InfoHint label="Preço">Dica do preço.</InfoHint>
      </>,
    );

    fireEvent.mouseEnter(botao("Preço"));

    expect(screen.getByRole("tooltip")).toHaveTextContent("Dica do preço.");
  });

  it("não envia o formulário em que estiver (é type=button)", () => {
    render(<InfoHint label="Quantidade">Texto.</InfoHint>);

    expect(botao("Quantidade")).toHaveAttribute("type", "button");
  });
});
