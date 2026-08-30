import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CollapsibleSection from "@/components/CollapsibleSection";

describe("CollapsibleSection", () => {
  it("começa aberta por padrão", () => {
    render(
      <CollapsibleSection title="Aluguéis de Temporada">
        <p>conteúdo interno</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("Aluguéis de Temporada")).toBeInTheDocument();
    expect(screen.getByText("conteúdo interno")).toBeInTheDocument();
  });

  it("pode começar fechada", () => {
    render(
      <CollapsibleSection title="Seção" defaultOpen={false}>
        <p>conteúdo interno</p>
      </CollapsibleSection>,
    );

    expect(screen.queryByText("conteúdo interno")).not.toBeInTheDocument();
  });

  it("fecha e reabre ao clicar no cabeçalho", () => {
    render(
      <CollapsibleSection title="Seção">
        <p>conteúdo interno</p>
      </CollapsibleSection>,
    );

    const cabecalho = screen.getByRole("button", { name: /Seção/ });

    fireEvent.click(cabecalho);
    expect(screen.queryByText("conteúdo interno")).not.toBeInTheDocument();

    fireEvent.click(cabecalho);
    expect(screen.getByText("conteúdo interno")).toBeInTheDocument();
  });

  it("mostra o subtítulo quando informado", () => {
    render(
      <CollapsibleSection title="Seção" subtitle="3 registros">
        <p>x</p>
      </CollapsibleSection>,
    );

    expect(screen.getByText("3 registros")).toBeInTheDocument();
  });

  it("não renderiza subtítulo quando não informado", () => {
    render(
      <CollapsibleSection title="Seção">
        <p>x</p>
      </CollapsibleSection>,
    );

    expect(screen.getByRole("button", { name: "› Seção" })).toBeInTheDocument();
  });

  it("mostra a ação do cabeçalho e ela não recolhe a seção", () => {
    const onClick = vi.fn();
    render(
      <CollapsibleSection
        title="Seção"
        headerAction={
          <button type="button" onClick={onClick}>
            Novo
          </button>
        }
      >
        <p>conteúdo interno</p>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Novo" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    // O stopPropagation impede que o clique também recolha a seção.
    expect(screen.getByText("conteúdo interno")).toBeInTheDocument();
  });

  it("gira a seta conforme o estado aberto/fechado", () => {
    render(
      <CollapsibleSection title="Seção">
        <p>x</p>
      </CollapsibleSection>,
    );

    const seta = screen.getByText("›");
    expect(seta.className).toContain("rotate-90");

    fireEvent.click(screen.getByRole("button", { name: /Seção/ }));
    expect(screen.getByText("›").className).not.toContain("rotate-90");
  });
});
