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
  default: ({ transactionId, categoryId }: { transactionId: string; categoryId: string | null }) => (
    <div data-testid="painel-itens">
      detalhamento de {transactionId} (categoria {String(categoryId)})
    </div>
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

  it("acrescenta a coluna de mover só quando onMoveToFamily é informado", () => {
    const { rerender } = render(
      <TransactionsTable transactions={[transacao()]} categories={categorias} />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);

    rerender(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onMoveToFamily={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });

  it("as duas colunas de ação somam 8 cabeçalhos", () => {
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDelete={vi.fn()}
        onMoveToFamily={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(8);
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

  it("avisa o id ao clicar em mover para a família", () => {
    const onMoveToFamily = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onMoveToFamily={onMoveToFamily}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "→ Família" }));

    // Recebe a transação inteira, não só o id: o diálogo de confirmação da
    // página precisa da descrição e do tipo.
    expect(onMoveToFamily).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-1" }));
  });

  it("sem onMoveToFamily não existe botão de mover", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.queryByRole("button", { name: "→ Família" })).not.toBeInTheDocument();
  });

  it("cada linha tem seu próprio botão de mover", () => {
    const onMoveToFamily = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao(), transacao({ id: "tx-2" })]}
        categories={categorias}
        onMoveToFamily={onMoveToFamily}
      />,
    );

    const botoes = screen.getAllByRole("button", { name: "→ Família" });
    expect(botoes).toHaveLength(2);

    fireEvent.click(botoes[1]);

    expect(onMoveToFamily).toHaveBeenCalledWith(expect.objectContaining({ id: "tx-2" }));
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

  it("o colSpan cresce com a coluna de mover", () => {
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDelete={vi.fn()}
        onMoveToFamily={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens").closest("td")).toHaveAttribute("colSpan", "8");
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

describe("TransactionsTable — data editável", () => {
  it("mostra a data formatada, e não um campo, quando onDateChange não é informado", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(screen.queryByLabelText("Data de SUPERMERCADO BH")).not.toBeInTheDocument();
  });

  it("mostra um input de data preenchido quando onDateChange é informado", () => {
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDateChange={vi.fn()}
      />,
    );

    const campo = screen.getByLabelText("Data de SUPERMERCADO BH") as HTMLInputElement;
    expect(campo.type).toBe("date");
    expect(campo.value).toBe("2026-08-15");
  });

  it("preenche o campo pelo dia LOCAL quando a data vem como ISO completo", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ date: "2026-08-15T03:00:00.000Z" })]}
        categories={categorias}
        onDateChange={vi.fn()}
      />,
    );

    expect((screen.getByLabelText("Data de SUPERMERCADO BH") as HTMLInputElement).value).toBe(
      "2026-08-15",
    );
  });

  it("avisa a nova data no formato que a rota espera", () => {
    const onDateChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDateChange={onDateChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Data de SUPERMERCADO BH"), {
      target: { value: "2026-09-02" },
    });

    expect(onDateChange).toHaveBeenCalledWith("tx-1", "2026-09-02");
  });

  it("apagar a data não grava nada (a transação precisa de uma data)", () => {
    const onDateChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDateChange={onDateChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Data de SUPERMERCADO BH"), { target: { value: "" } });

    expect(onDateChange).not.toHaveBeenCalled();
  });

  it("cada linha edita a sua própria data", () => {
    const onDateChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao(), transacao({ id: "tx-2", description: "PADARIA" })]}
        categories={categorias}
        onDateChange={onDateChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Data de PADARIA"), {
      target: { value: "2026-08-20" },
    });

    expect(onDateChange).toHaveBeenCalledWith("tx-2", "2026-08-20");
  });
});

describe("TransactionsTable — descrição editável", () => {
  /** Renderiza a tabela com a descrição editável e devolve o campo e o espião. */
  function comDescricaoEditavel(over = {}) {
    const onDescriptionChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao(over)]}
        categories={categorias}
        onDescriptionChange={onDescriptionChange}
      />,
    );
    const campo = screen.getByLabelText("Descrição de SUPERMERCADO BH") as HTMLInputElement;
    return { campo, onDescriptionChange };
  }

  it("mostra um campo de texto preenchido com a descrição atual", () => {
    const { campo } = comDescricaoEditavel();

    expect(campo.type).toBe("text");
    expect(campo.value).toBe("SUPERMERCADO BH");
  });

  it("sem onDescriptionChange a descrição é só texto", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(screen.queryByLabelText("Descrição de SUPERMERCADO BH")).not.toBeInTheDocument();
    expect(screen.getByText("SUPERMERCADO BH")).toBeInTheDocument();
  });

  it("grava ao sair do campo", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "Supermercado BH — feira" } });
    fireEvent.blur(campo);

    expect(onDescriptionChange).toHaveBeenCalledWith("tx-1", "Supermercado BH — feira");
  });

  it("Enter tira o foco e cai no mesmo caminho de gravação", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    // O blur() do jsdom só dispara o evento se o campo estiver realmente
    // focado — sem o focus() aqui o teste passaria sem exercitar nada.
    campo.focus();
    fireEvent.change(campo, { target: { value: "Padaria da esquina" } });
    fireEvent.keyDown(campo, { key: "Enter" });

    expect(onDescriptionChange).toHaveBeenCalledWith("tx-1", "Padaria da esquina");
  });

  it("outra tecla não grava (só Enter tira o foco)", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "Padaria" } });
    fireEvent.keyDown(campo, { key: "a" });

    expect(onDescriptionChange).not.toHaveBeenCalled();
  });

  it("digitar não grava nada antes de sair do campo", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "SUPERMERCADO B" } });

    expect(campo.value).toBe("SUPERMERCADO B");
    expect(onDescriptionChange).not.toHaveBeenCalled();
  });

  it("sair do campo sem mudar nada não grava", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.blur(campo);

    expect(onDescriptionChange).not.toHaveBeenCalled();
  });

  it("espaço em volta é aparado antes de gravar", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "  Feira do mês  " } });
    fireEvent.blur(campo);

    expect(onDescriptionChange).toHaveBeenCalledWith("tx-1", "Feira do mês");
    expect(campo.value).toBe("Feira do mês");
  });

  it("texto que só ganhou espaço em volta não vira gravação", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "  SUPERMERCADO BH  " } });
    fireEvent.blur(campo);

    expect(onDescriptionChange).not.toHaveBeenCalled();
  });

  it("descrição em branco volta para a original em vez de ser gravada", () => {
    const { campo, onDescriptionChange } = comDescricaoEditavel();

    fireEvent.change(campo, { target: { value: "   " } });
    fireEvent.blur(campo);

    expect(onDescriptionChange).not.toHaveBeenCalled();
    expect(campo.value).toBe("SUPERMERCADO BH");
  });

  it("a linha continua expansível pela seta", () => {
    render(
      <TransactionsTable
        transactions={[transacao()]}
        categories={categorias}
        onDescriptionChange={vi.fn()}
      />,
    );

    const seta = screen.getByRole("button", { name: "Ver detalhamento de SUPERMERCADO BH" });
    expect(seta.className).not.toContain("rotate-90");

    fireEvent.click(seta);

    expect(screen.getByTestId("painel-itens")).toHaveTextContent("detalhamento de tx-1");
    expect(seta.className).toContain("rotate-90");

    fireEvent.click(seta);
    expect(screen.queryByTestId("painel-itens")).not.toBeInTheDocument();
  });

  it("marcador de pendência e número de parcela continuam visíveis no modo editável", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ pendingReturn: true, installmentCurrent: 2, installmentTotal: 10 })]}
        categories={categorias}
        onDescriptionChange={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Pendente de devolução")).toBeInTheDocument();
    expect(screen.getByText("(2/10)")).toBeInTheDocument();
  });

  it("sem parcela completa, nada de parcela aparece no modo editável", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ installmentCurrent: 2, installmentTotal: null })]}
        categories={categorias}
        onDescriptionChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/\(2\//)).not.toBeInTheDocument();
  });
});

describe("TransactionsTable — categoria repassada ao detalhamento", () => {
  // O painel recarrega os itens quando a categoria muda, porque a categoria
  // nova pode ter criado sub-itens fixos no servidor.
  it("repassa a categoria da transação", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens")).toHaveTextContent("categoria cat-1");
  });

  it("transação sem categoria repassa null", () => {
    render(
      <TransactionsTable
        transactions={[transacao({ categoryId: null, category: null })]}
        categories={categorias}
      />,
    );

    fireEvent.click(screen.getByText("SUPERMERCADO BH"));

    expect(screen.getByTestId("painel-itens")).toHaveTextContent("categoria null");
  });
});

describe("TransactionsTable — valor editável", () => {
  /** Renderiza a tabela com o valor editável e devolve o campo e o espião. */
  function comValorEditavel(over = {}) {
    const onAmountChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao(over)]}
        categories={categorias}
        onAmountChange={onAmountChange}
      />,
    );
    const campo = screen.getByLabelText("Valor de SUPERMERCADO BH") as HTMLInputElement;
    return { campo, onAmountChange };
  }

  it("mostra o valor formatado, e não um campo, quando onAmountChange não é informado", () => {
    render(<TransactionsTable transactions={[transacao()]} categories={categorias} />);

    expect(norm(screen.getByText(norm("R$ 150,00")).textContent)).toBe(norm("R$ 150,00"));
    expect(screen.queryByLabelText("Valor de SUPERMERCADO BH")).not.toBeInTheDocument();
  });

  it("mostra o valor no padrão brasileiro e sem o prefixo de moeda", () => {
    // O "R$ " sairia na frente do cursor num campo feito para digitar.
    const { campo } = comValorEditavel({ amount: "1234.50" });

    expect(campo.value).toBe("1.234,50");
    expect(campo.getAttribute("inputMode")).toBe("decimal");
    expect(campo.type).toBe("text");
  });

  it("grava o novo valor ao sair do campo", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "200,50" } });
    fireEvent.blur(campo);

    // Chega como NÚMERO: a célula converte o texto antes de repassar.
    expect(onAmountChange).toHaveBeenCalledWith("tx-1", 200.5);
  });

  it("aceita vírgula e ponto como o mesmo separador decimal", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "200.50" } });
    fireEvent.blur(campo);

    expect(onAmountChange).toHaveBeenCalledWith("tx-1", 200.5);
  });

  it("lê o separador de milhar junto com o decimal", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "1.234,56" } });
    fireEvent.blur(campo);

    expect(onAmountChange).toHaveBeenCalledWith("tx-1", 1234.56);
  });

  it("Enter tira o foco e grava (sem botão de salvar)", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "300" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    fireEvent.blur(campo);

    expect(onAmountChange).toHaveBeenCalledWith("tx-1", 300);
  });

  it("mostra no campo o valor que ENTENDEU depois de gravar", () => {
    // "1.000" é ambíguo de verdade e a regra do app lê um separador sozinho
    // como decimal. Em vez de um eco embaixo da linha (que dobraria a altura
    // da tabela), a própria célula passa a mostrar o número interpretado.
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "1.000" } });
    fireEvent.blur(campo);

    expect(onAmountChange).toHaveBeenCalledWith("tx-1", 1);
    expect(campo.value).toBe("1,00");
  });

  it("texto ilegível é revertido para o valor atual, sem gravar", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "12abc" } });
    fireEvent.blur(campo);

    expect(onAmountChange).not.toHaveBeenCalled();
    expect(campo.value).toBe("150,00");
  });

  it("campo vazio é revertido para o valor atual, sem gravar", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);

    expect(onAmountChange).not.toHaveBeenCalled();
    expect(campo.value).toBe("150,00");
  });

  it("valor zero ou negativo é revertido, sem gravar (a rota exige positivo)", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "0" } });
    fireEvent.blur(campo);
    expect(onAmountChange).not.toHaveBeenCalled();

    fireEvent.change(campo, { target: { value: "-10" } });
    fireEvent.blur(campo);
    expect(onAmountChange).not.toHaveBeenCalled();
    expect(campo.value).toBe("150,00");
  });

  it("valor que não mudou não gera gravação", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.blur(campo);
    expect(onAmountChange).not.toHaveBeenCalled();

    // Mesmo número escrito de outro jeito também não é mudança.
    fireEvent.change(campo, { target: { value: "150" } });
    fireEvent.blur(campo);
    expect(onAmountChange).not.toHaveBeenCalled();
  });

  it("outra tecla não grava nada (só o Enter tira o foco)", () => {
    const { campo, onAmountChange } = comValorEditavel();

    fireEvent.change(campo, { target: { value: "200" } });
    fireEvent.keyDown(campo, { key: "a" });

    expect(onAmountChange).not.toHaveBeenCalled();
    expect(campo.value).toBe("200");
  });

  it("cada linha edita o seu próprio valor", () => {
    const onAmountChange = vi.fn();
    render(
      <TransactionsTable
        transactions={[transacao(), transacao({ id: "tx-2", description: "PADARIA", amount: "30.00" })]}
        categories={categorias}
        onAmountChange={onAmountChange}
      />,
    );

    const campo = screen.getByLabelText("Valor de PADARIA") as HTMLInputElement;
    expect(campo.value).toBe("30,00");
    fireEvent.change(campo, { target: { value: "45" } });
    fireEvent.blur(campo);

    expect(onAmountChange).toHaveBeenCalledWith("tx-2", 45);
  });
});

describe("TransactionsTable — edição bloqueada por linha (isRowEditable)", () => {
  const receitaDeAluguel = transacao({
    id: "tx-aluguel",
    description: "Repasse aluguel",
    type: "INCOME",
    amount: "1000.00",
    category: { ...categorias[1], name: "Aluguel Rancho" },
  });

  /** Só a transação de aluguel é bloqueada; a outra continua editável. */
  const gate = (t: Transaction) => t.category?.name !== "Aluguel Rancho";

  function comGate() {
    const espioes = {
      onCategoryChange: vi.fn(),
      onDateChange: vi.fn(),
      onDescriptionChange: vi.fn(),
      onAmountChange: vi.fn(),
      onDelete: vi.fn(),
    };
    render(
      <TransactionsTable
        transactions={[transacao(), receitaDeAluguel]}
        categories={categorias}
        isRowEditable={gate}
        {...espioes}
      />,
    );
    return espioes;
  }

  it("a linha bloqueada mostra data, descrição e valor só de leitura", () => {
    comGate();

    expect(screen.queryByLabelText("Data de Repasse aluguel")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Descrição de Repasse aluguel")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Valor de Repasse aluguel")).not.toBeInTheDocument();
    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 1.000,00"));
  });

  it("a linha bloqueada mostra a categoria como etiqueta, sem select", () => {
    comGate();

    // Só a linha liberada tem select de categoria.
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("Aluguel Rancho")).toBeInTheDocument();
  });

  it("a linha bloqueada não tem botão de excluir (mas a coluna continua)", () => {
    comGate();

    expect(screen.getAllByRole("button", { name: "excluir" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  });

  it("a linha liberada continua editando tudo", () => {
    const espioes = comGate();

    fireEvent.change(screen.getByLabelText("Data de SUPERMERCADO BH"), {
      target: { value: "2026-08-20" },
    });
    const descricao = screen.getByLabelText("Descrição de SUPERMERCADO BH");
    fireEvent.change(descricao, { target: { value: "MERCADO" } });
    fireEvent.blur(descricao);
    const valor = screen.getByLabelText("Valor de SUPERMERCADO BH");
    fireEvent.change(valor, { target: { value: "99" } });
    fireEvent.blur(valor);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-2" } });
    fireEvent.click(screen.getByRole("button", { name: "excluir" }));

    expect(espioes.onDateChange).toHaveBeenCalledWith("tx-1", "2026-08-20");
    expect(espioes.onDescriptionChange).toHaveBeenCalledWith("tx-1", "MERCADO");
    expect(espioes.onAmountChange).toHaveBeenCalledWith("tx-1", 99);
    expect(espioes.onCategoryChange).toHaveBeenCalledWith("tx-1", "cat-2");
    expect(espioes.onDelete).toHaveBeenCalledWith("tx-1");
  });

  it("a linha bloqueada continua expansível (é leitura, não sumiço)", () => {
    comGate();

    fireEvent.click(screen.getByRole("button", { name: /Repasse aluguel/ }));

    expect(screen.getByTestId("painel-itens")).toHaveTextContent("detalhamento de tx-aluguel");
  });

  it("sem isRowEditable todas as linhas são editáveis", () => {
    render(
      <TransactionsTable
        transactions={[transacao(), receitaDeAluguel]}
        categories={categorias}
        onDateChange={vi.fn()}
        onAmountChange={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Data de Repasse aluguel")).toBeInTheDocument();
    expect(screen.getByLabelText("Valor de Repasse aluguel")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "excluir" })).toHaveLength(2);
  });
});
