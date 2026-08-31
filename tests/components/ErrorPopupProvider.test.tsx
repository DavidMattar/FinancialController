import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ErrorPopupProvider, { useErrorPopup } from "@/components/ErrorPopupProvider";
import type { ExplainedError } from "@/lib/errorExplain";

function falha(over: Partial<ExplainedError> = {}): ExplainedError {
  return {
    title: "Dados recusados pelo servidor",
    what: "O servidor recusou os dados enviados e não gravou nada.",
    why: "Algum valor não passou na validação.",
    hint: "Revise os campos e envie de novo.",
    technical: "POST /api/transactions · HTTP 400",
    ...over,
  };
}

/** Botão que dispara uma falha, para o teste exercitar o provider de fora. */
function Disparador({ erros }: { erros: ExplainedError[] }) {
  const { report } = useErrorPopup();
  return (
    <button type="button" onClick={() => erros.forEach(report)}>
      falhar
    </button>
  );
}

function montar(erros: ExplainedError[]) {
  render(
    <ErrorPopupProvider>
      <Disparador erros={erros} />
    </ErrorPopupProvider>,
  );
  return () => fireEvent.click(screen.getByRole("button", { name: "falhar" }));
}

describe("ErrorPopupProvider", () => {
  it("não mostra nada enquanto não há erro", () => {
    montar([falha()]);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("renderiza os filhos normalmente", () => {
    montar([falha()]);

    expect(screen.getByRole("button", { name: "falhar" })).toBeInTheDocument();
  });

  it("abre o pop-up explicando o que e o por que", () => {
    const falhar = montar([falha()]);

    falhar();

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveTextContent("Dados recusados pelo servidor");
    expect(dialogo).toHaveTextContent("O que aconteceu");
    expect(dialogo).toHaveTextContent("não gravou nada");
    expect(dialogo).toHaveTextContent("Por que aconteceu");
    expect(dialogo).toHaveTextContent("não passou na validação");
    expect(dialogo).toHaveTextContent("O que fazer");
  });

  it("omite a seção 'o que fazer' quando não há dica", () => {
    const falhar = montar([falha({ hint: undefined })]);

    falhar();

    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("O que fazer");
  });

  it("esconde o detalhe técnico até o usuário pedir", () => {
    const falhar = montar([falha()]);
    falhar();

    expect(screen.queryByText(/HTTP 400/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ver detalhe técnico" }));

    expect(screen.getByText(/POST \/api\/transactions · HTTP 400/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "esconder detalhe técnico" }));

    expect(screen.queryByText(/HTTP 400/)).not.toBeInTheDocument();
  });

  it("não oferece detalhe técnico quando não existe", () => {
    const falhar = montar([falha({ technical: undefined })]);

    falhar();

    expect(screen.queryByRole("button", { name: /detalhe técnico/ })).not.toBeInTheDocument();
  });

  it("diz onde o erro foi gravado", () => {
    // O pop-up é o canal imediato; o arquivo é o registro permanente.
    const falhar = montar([falha()]);

    falhar();

    expect(screen.getByRole("alertdialog")).toHaveTextContent("erros.log");
  });

  it("fecha no 'Entendi'", () => {
    const falhar = montar([falha()]);
    falhar();

    fireEvent.click(screen.getByRole("button", { name: "Entendi" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("NÃO fecha ao clicar fora", () => {
    // Diferente do ConfirmDialog: aqui o conteúdo é explicação que o usuário
    // precisa ter lido, e um clique distraído a descartaria.
    const falhar = montar([falha()]);
    falhar();

    fireEvent.click(screen.getByRole("alertdialog").parentElement!);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

describe("ErrorPopupProvider — fila", () => {
  it("erros diferentes entram na fila e são lidos um a um", () => {
    const falhar = montar([falha({ title: "Primeiro" }), falha({ title: "Segundo" })]);

    falhar();

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Primeiro");
    expect(screen.getByText("+1 outro erro na fila")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent("Segundo");
    expect(screen.getByRole("button", { name: "Entendi" })).toBeInTheDocument();
  });

  it("pluraliza a contagem da fila", () => {
    const falhar = montar([
      falha({ title: "A" }),
      falha({ title: "B" }),
      falha({ title: "C" }),
    ]);

    falhar();

    expect(screen.getByText("+2 outros erros na fila")).toBeInTheDocument();
  });

  it("'Fechar todos' descarta a fila inteira", () => {
    const falhar = montar([falha({ title: "A" }), falha({ title: "B" })]);
    falhar();

    fireEvent.click(screen.getByRole("button", { name: "Fechar todos" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("erro idêntico seguido não é enfileirado duas vezes", () => {
    // Uma tela que reenvia sozinha (ou um efeito que roda duas vezes) geraria
    // a mesma mensagem repetida.
    const falhar = montar([falha(), falha()]);

    falhar();

    expect(screen.queryByText(/na fila/)).not.toBeInTheDocument();
  });

  it("erro diferente só no detalhe técnico ainda é um erro novo", () => {
    const falhar = montar([falha({ technical: "HTTP 400" }), falha({ technical: "HTTP 500" })]);

    falhar();

    expect(screen.getByText("+1 outro erro na fila")).toBeInTheDocument();
  });

  it("não some com o 'Fechar todos' quando há um erro só", () => {
    const falhar = montar([falha()]);

    falhar();

    expect(screen.queryByRole("button", { name: "Fechar todos" })).not.toBeInTheDocument();
  });
});

describe("useErrorPopup fora do provider", () => {
  it("não lança: só não abre pop-up", () => {
    // Acontece em teste que monta um componente isolado; nesse caso não abrir
    // é o comportamento certo.
    render(<Disparador erros={[falha()]} />);

    fireEvent.click(screen.getByRole("button", { name: "falhar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
