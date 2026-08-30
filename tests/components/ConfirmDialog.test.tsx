import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ConfirmDialog from "@/components/ConfirmDialog";

const props = {
  open: true,
  message: "Tem certeza que deseja excluir?",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("ConfirmDialog", () => {
  it("não renderiza nada quando está fechado", () => {
    const { container } = render(<ConfirmDialog {...props} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra título padrão, mensagem e os dois botões", () => {
    render(<ConfirmDialog {...props} />);

    expect(screen.getByText("Confirmar ação")).toBeInTheDocument();
    expect(screen.getByText("Tem certeza que deseja excluir?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
  });

  it("aceita título e rótulos customizados", () => {
    render(
      <ConfirmDialog
        {...props}
        title="Apagar tudo?"
        confirmLabel="Apagar e restaurar"
        cancelLabel="Voltar"
      />,
    );

    expect(screen.getByText("Apagar tudo?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar e restaurar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });

  it("chama onConfirm no botão de confirmar", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("chama onCancel no botão de cancelar", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicar no fundo escuro cancela", () => {
    const onCancel = vi.fn();
    const { container } = render(<ConfirmDialog {...props} onCancel={onCancel} />);

    fireEvent.click(container.firstElementChild!);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("clicar dentro do diálogo NÃO cancela", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("alertdialog"));

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("usa botão vermelho por padrão (ação destrutiva)", () => {
    render(<ConfirmDialog {...props} />);
    expect(screen.getByRole("button", { name: "Confirmar" }).className).toContain("bg-red-600");
  });

  it("usa botão indigo quando não é destrutivo", () => {
    render(<ConfirmDialog {...props} danger={false} />);
    expect(screen.getByRole("button", { name: "Confirmar" }).className).toContain("bg-indigo-600");
  });

  it("é anunciado como alertdialog modal, com o título ligado por aria", () => {
    render(<ConfirmDialog {...props} />);

    const dialogo = screen.getByRole("alertdialog");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    expect(dialogo).toHaveAttribute("aria-labelledby", "confirm-dialog-title");
    expect(screen.getByText("Confirmar ação")).toHaveAttribute("id", "confirm-dialog-title");
  });
});
