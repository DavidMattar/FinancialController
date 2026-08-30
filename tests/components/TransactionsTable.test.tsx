import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import TransactionsTable from "@/components/TransactionsTable";
import { normalizarEspacos as norm } from "../helpers/text";
import type { Category, Transaction } from "@/lib/types";

/**
 * O painel de detalhamento (`TransactionItemsPanel`) é substituído por um dublê:
 * ele tem seus próprios testes, e aqui o que importa é a tabela abrir/fechar a
 * linha certa. Sem o dublê, cada expansão dispararia fetch do painel real.
 */
vi.mock("@/components/TransactionItemsPanel", () => ({
  default: ({ transactionId }: { transactionId: string }) => (
    <div data-testid="painel-itens">detalhamento de {transactionId}</div>
  ),
}));

const categorias: Category[] = [
  { id: "cat-1", name: "Supermercado", color: "#22c55e", icon: "cart", kind: "EXPENSE", keywords: [] },
  { id: "cat-2", name: "Salário", color: "#16a34a", icon: "wallet", kind: "INCOME", keywords: [] },
];

function transacao(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    date: "2026-08-15",
    description: "SUPERMERCADO BH",
    amount: "150.00",
    currency: "BRL",
    type: "EXPENSE",
    source: "MANUAL",
    categoryId: "cat-1",
    category: categorias[0],
    ...over,
  };
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TransactionsTable — estado vazio e cabeçalho", () => {
  it("mostra mensagem quando não há transação", () => {
    render(<TransactionsTable transactions={[]} categories={categorias} />);

    expect(screen.getByText("Nenhuma transação encontrada.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("mostra as colunas padrão", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    for (const coluna of ["Data", "Descrição", "Cartão", "Categoria", "Tipo", "Valor"]) {
      expect(screen.getByRole("columnheader", { name: coluna })).toBeInTheDocument();
    }
  });

  it("acrescenta a coluna de excluir só quando onDelete é informado", () => {
    const { rerender } = render(
      <TransactionsTable transactions={[transacao()]} categories={categorias} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);

    rerender(
      <TransactionsTable transactions={[transacao()]} categories={categorias} onDelete={vi.fn()} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });
});

describe("TransactionsTable — conteúdo da linha", () => {
  it("mostra data em formato brasileiro, descrição e valor", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(screen.getByText("SUPERMERCADO BH")).toBeInTheDocument();
    expect(norm(screen.getByText(/150,00/).textContent)).toBe(norm("R$ 150,00"));
  });

  it("mostra os últimos dígitos do cartão, ou travessão quando não há cartão", () => {
    const { rerender } = render(
      <TransactionsTable
        transactions={[transacao({ creditCard: { id: "c1", bank: "Santander", holderName: "D", lastDigits: "8258" } })]}
        categories={categorias}
      />,
    );
    expect(screen.getByText("****8258")).toBeInTheDocument();

    rerender(<TransactionsTable transactions={[transacao()]} categories={categorias} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("traduz o tipo da transação", () => {
    render(
      <TransactionsTable
        transactions={[
          transacao({ id: "t1", type: "EXPENSE" }),
          transacao({ id: "t2", type: "INCOME" }),
          transacao({ id: "t3", type: "PAYMENT" }),
        ]}
        categories={categorias}
      />,
    );

    expect(screen.getByText("Despesa")).toBeInTheDocument();
    expect(screen.getByText("Crédito")).toBeInTheDocument();
    expect(screen.getByText("Pagamento")).toBeInTheDocument();
  });

  it("mostra sinal negativo no valor de um pagamento de fatura", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ type: "PAYMENT", amount: "2000" })]}
        categories={categorias}
      />,
    );

    expect(norm(screen.getByText(/2\.000,00/).textContent)).toBe(norm("-R$ 2.000,00"));
  });

  it("mostra o número da parcela quando existe", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ installmentCurrent: 2, installmentTotal: 10 })]}
        categories={categorias}
      />,
    );

    expect(screen.getByText("(2/10)")).toBeInTheDocument();
  });

  it("não mostra parcela quando só um dos campos vem preenchido", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ installmentCurrent: 2, installmentTotal: null })]}
        categories={categorias}
      />,
    );

    expect(screen.queryByText(/\(2\//)).not.toBeInTheDocument();
  });

  it("mostra a categoria como etiqueta colorida", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    const etiqueta = screen.getByText("Supermercado");
    expect(etiqueta).toHaveStyle({ color: "#22c55e" });
  });

  it("mostra 'Sem categoria' quando a transação não tem categoria", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ category: null, categoryId: null })]}
        categories={categorias}
      />,
    );

    expect(screen.getByText("Sem categoria")).toBeInTheDocument();
  });
});

describe("TransactionsTable — pendência de devolução", () => {
  it("destaca a linha em vermelho e mostra o marcador", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ pendingReturn: true })]}
        categories={categorias}
      />,
    );

    expect(screen.getByTitle("Pendente de devolução")).toBeInTheDocument();
    const linha = screen.getByText("SUPERMERCADO BH").closest("tr")!;
    expect(linha.className).toContain("bg-red-50");
  });

  it("linha normal não fica vermelha nem tem marcador", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.queryByTitle("Pendente de devolução")).not.toBeInTheDocument();
    const linha = screen.getByText("SUPERMERCADO BH").closest("tr")!;
    expect(linha.className).not.toContain("bg-red-50");
  });
});

describe("TransactionsTable — categoria editável", () => {
  it("mostra um select quando onCategoryChange é informado", () => {
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onCategoryChange={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("cat-1");
    expect(screen.getByRole("option", { name: "Sem categoria" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Supermercado" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Salário" })).toBeInTheDocument();
  });

  it("avisa a troca de categoria", () => {
    const onCategoryChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onCategoryChange={onCategoryChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-2" } });

    expect(onCategoryChange).toHaveBeenCalledWith("tx-1", "cat-2");
  });

  it("escolher 'Sem categoria' envia null", () => {
    const onCategoryChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onCategoryChange={onCategoryChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

    expect(onCategoryChange).toHaveBeenCalledWith("tx-1", null);
  });

  it("select fica vazio quando a transação não tem categoria", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ categoryId: null, category: null })]}
        categories={categorias}
        onCategoryChange={vi.fn()}
      />,
    );

    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  });
});

describe("TransactionsTable — exclusão", () => {
  it("avisa o id ao clicar em excluir", () => {
    const onDelete = vi.fn();
    render(
      <TransactionsTable transactions={[transacao()]} categories={categorias} onDelete={onDelete} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(onDelete).toHaveBeenCalledWith("tx-1");
  });

  it("sem onDelete não existe botão de excluir", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);
    expect(screen.queryByRole("button", { name: "excluir" })).not.toBeInTheDocument();
  });
});

describe("TransactionsTable — detalhamento expansível", () => {
  it("começa fechado", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);
    expect(screen.queryByTestId("painel-itens")).not.toBeInTheDocument();
  });

  it("abre o detalhamento ao clicar na descrição", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens")).toHaveTextContent("detalhamento de tx-1");
  });

  it("fecha ao clicar de novo na mesma linha", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));
    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.queryByTestId("painel-itens")).not.toBeInTheDocument();
  });

  it("abre uma linha por vez", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ id: "tx-1" }), transacao({ id: "tx-2", description: "PADARIA" })]}
        categories={categorias}
      />,
    );

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));
    fireEvent.click(screen.getByText("PADARIA"));

    const paineis = screen.getAllByTestId("painel-itens");
    expect(paineis).toHaveLength(1);
    expect(paineis[0]).toHaveTextContent("detalhamento de tx-2");
  });

  it("a linha expandida ocupa todas as colunas", () => {
    render(
      <TransactionsTable transactions={[transacao()]} categories={categorias} onDelete={vi.fn()} />,
    );

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens").closest("td")).toHaveAttribute("colSpan", "7");
  });

  it("sem a coluna de excluir, o colSpan é 6", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens").closest("td")).toHaveAttribute("colSpan", "6");
  });

  it("gira a seta quando expande", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.getByText("›").className).not.toContain("rotate-90");
    fireEvent.click(screen.getByText("SUPERMERCADO BH"));
    expect(screen.getByText("›").className).toContain("rotate-90");
  });
});
