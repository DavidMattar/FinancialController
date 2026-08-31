import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ParsedValueHint from "@/components/ParsedValueHint";
import { normalizarEspacos as norm } from "../helpers/text";

/** O texto do eco, com os espaços do Intl normalizados. */
function eco(): string {
  return norm(document.body.textContent);
}

describe("ParsedValueHint", () => {
  it("não mostra nada com o campo vazio", () => {
    render(<ParsedValueHint raw="" kind="money" />);
    expect(document.body.textContent).toBe("");
  });

  it("não mostra nada com o campo só em espaços", () => {
    render(<ParsedValueHint raw="   " kind="money" />);
    expect(document.body.textContent).toBe("");
  });

  it("ecoa o valor em reais", () => {
    render(<ParsedValueHint raw="1234,56" kind="money" />);
    expect(eco()).toBe(norm("= R$ 1.234,56"));
  });

  it("desfaz a ambiguidade de '1.000' mostrando o que entendeu", () => {
    // É a razão de o componente existir: a regra lê um ponto sozinho como
    // decimal, e o usuário vê isso ANTES de salvar em vez de descobrir depois.
    render(<ParsedValueHint raw="1.000" kind="money" />);
    expect(eco()).toBe(norm("= R$ 1,00"));
  });

  it("mostra mil quando o usuário escreve o milhar com a vírgula decimal", () => {
    render(<ParsedValueHint raw="1.000,00" kind="money" />);
    expect(eco()).toBe(norm("= R$ 1.000,00"));
  });

  it("ecoa número puro quando não é dinheiro", () => {
    // Quantidade de um ativo não é valor em reais.
    render(<ParsedValueHint raw="0,5" kind="plain" />);
    expect(eco()).toBe("= 0,5");
  });

  it("no modo puro mantém até 8 casas (a precisão de quantidade do banco)", () => {
    render(<ParsedValueHint raw="0,00000001" kind="plain" />);
    expect(eco()).toBe("= 0,00000001");
  });

  it("avisa quando não conseguiu ler o número", () => {
    render(<ParsedValueHint raw="1e3" kind="money" />);

    expect(screen.getByText(/Não consegui ler esse número/)).toBeInTheDocument();
    expect(screen.getByText(/Não consegui ler esse número/).className).toContain("text-red-600");
  });

  it("aceita prefixo de moeda e separador de milhar", () => {
    render(<ParsedValueHint raw="R$ 350.000,00" kind="money" />);
    expect(eco()).toBe(norm("= R$ 350.000,00"));
  });

  it("ecoa negativo", () => {
    render(<ParsedValueHint raw="-12,50" kind="money" />);
    expect(eco()).toBe(norm("= -R$ 12,50"));
  });

  it("ecoa zero (que é um valor válido, não campo vazio)", () => {
    render(<ParsedValueHint raw="0" kind="money" />);
    expect(eco()).toBe(norm("= R$ 0,00"));
  });
});
