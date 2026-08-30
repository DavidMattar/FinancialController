import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InvoiceImportPanel from "@/components/InvoiceImportPanel";
import { normalizarEspacos as norm } from "../helpers/text";

let fetchMock: ReturnType<typeof vi.fn>;

const lancamento = {
  date: "2026-08-05T03:00:00.000Z",
  description: "SUPERMERCADO BH",
  amount: 150,
  type: "EXPENSE" as const,
  section: "DESPESA" as const,
  cardHolder: "DAVID MATTAR",
  cardLastDigits: "8258",
  suggestedCategory: { id: "cat-super", name: "Supermercado", color: "#22c55e" },
};

const previewFatura = {
  bank: "Santander",
  referenceMonth: "2026-08",
  dueDate: "2026-08-15T03:00:00.000Z",
  totalAmount: 2829.29,
  minPayment: 282.92,
  computedTotal: 180,
  fileName: "Fatura_082026.pdf",
  cards: [{ holderName: "DAVID MATTAR", lastDigits: "8258" }],
  transactions: [
    lancamento,
    {
      ...lancamento,
      description: "PAGAMENTO DE FATURA",
      amount: 2000,
      type: "PAYMENT" as const,
      section: "CREDITO" as const,
      suggestedCategory: null,
    },
  ],
};

const categorias = [
  { id: "cat-super", name: "Supermercado" },
  { id: "cat-outros", name: "Outros" },
];

function comRespostas(opcoes: {
  parse?: { ok?: boolean; body?: unknown };
  confirm?: { ok?: boolean; body?: unknown };
  parseRejeita?: boolean;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/categories") return { ok: true, json: async () => categorias };
    if (url === "/api/invoices/parse") {
      if (opcoes.parseRejeita) throw new Error("network");
      return { ok: opcoes.parse?.ok ?? true, json: async () => opcoes.parse?.body ?? previewFatura };
    }
    if (url === "/api/invoices/confirm") {
      return {
        ok: opcoes.confirm?.ok ?? true,
        json: async () => opcoes.confirm?.body ?? { invoiceId: "inv-1", transactionsImported: 2 },
      };
    }
    throw new Error(`rota inesperada: ${url}`);
  });
}

/**
 * Escolhe o PDF e dispara o processamento.
 *
 * Submete o `<form>` em vez de clicar no botão porque o input de arquivo é
 * `required`: o jsdom roda a validação nativa no clique e, como ele não
 * considera o `files` atribuído pelo teste, o evento de submit nunca sairia.
 */
function processarPdf(senha?: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["pdf"], "Fatura_082026.pdf", { type: "application/pdf" })] },
  });
  if (senha !== undefined) {
    fireEvent.change(document.querySelector('input[type="password"]')!, {
      target: { value: senha },
    });
  }
  fireEvent.submit(document.querySelector("form")!);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InvoiceImportPanel — formulário inicial", () => {
  it("informa o banco suportado e que o processamento é local", () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    expect(screen.getByText(/Bancos suportados atualmente/)).toBeInTheDocument();
    expect(screen.getByText("Santander")).toBeInTheDocument();
    expect(screen.getByText(/processado localmente/)).toBeInTheDocument();
  });

  it("o botão fica desabilitado até escolher um arquivo", () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    expect(screen.getByRole("button", { name: "Processar fatura" })).toBeDisabled();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "f.pdf", { type: "application/pdf" })] },
    });

    expect(screen.getByRole("button", { name: "Processar fatura" })).not.toBeDisabled();
  });

  it("limpar a seleção volta a desabilitar o botão", () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "f.pdf", { type: "application/pdf" })] },
    });
    fireEvent.change(input, { target: { files: [] } });

    expect(screen.getByRole("button", { name: "Processar fatura" })).toBeDisabled();
  });

  it("envia o PDF junto com a senha quando informada", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf("12345678900");

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/parse");
      expect(chamada).toBeDefined();
      const form = chamada![1].body as FormData;
      expect(form.get("file")).toBeInstanceOf(File);
      expect(form.get("password")).toBe("12345678900");
    });
  });

  it("não envia o campo de senha quando ele fica vazio", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/parse");
      expect((chamada![1].body as FormData).get("password")).toBeNull();
    });
  });
});

describe("InvoiceImportPanel — etapa de preview", () => {
  it("mostra os dados gerais da fatura", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("2026-08")).toBeInTheDocument());
    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 2.829,29"));
  });

  it("mostra travessão quando a fatura não tem vencimento", async () => {
    comRespostas({ parse: { body: { ...previewFatura, dueDate: undefined } } });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("—")).toBeInTheDocument());
  });

  it("lista os lançamentos com data, descrição, titular e tipo", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("SUPERMERCADO BH")).toBeInTheDocument());
    // Os dois lançamentos do exemplo têm a mesma data.
    expect(screen.getAllByText("05/08/2026")).toHaveLength(2);
    expect(screen.getAllByText("****8258")).toHaveLength(2);
    expect(screen.getByText("Despesa")).toBeInTheDocument();
    expect(screen.getByText("Crédito/Pagamento")).toBeInTheDocument();
  });

  it("mostra a seção de parcelamento e o número da parcela", async () => {
    comRespostas({
      parse: {
        body: {
          ...previewFatura,
          transactions: [
            {
              ...lancamento,
              section: "PARCELAMENTO",
              installmentCurrent: 2,
              installmentTotal: 10,
            },
          ],
        },
      },
    });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("Parcelamento")).toBeInTheDocument());
    expect(screen.getByText(/\(2\/10\)/)).toBeInTheDocument();
  });

  it("mostra sinal negativo em lançamento que não é despesa", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("PAGAMENTO DE FATURA")).toBeInTheDocument());
    const linha = screen.getByText("PAGAMENTO DE FATURA").closest("tr")!;
    expect(norm(linha.textContent)).toContain(norm("-R$ 2.000,00"));
  });

  it("pré-seleciona a categoria sugerida de cada lançamento", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getAllByRole("combobox")).toHaveLength(2));
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(selects[0].value).toBe("cat-super");
    // O segundo lançamento não tinha sugestão.
    expect(selects[1].value).toBe("");
  });

  it("soma no título apenas as despesas selecionadas", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText(/2 selecionados/)).toBeInTheDocument());
    // Só a despesa de 150 entra na soma (o pagamento de 2000 não).
    expect(norm(screen.getByText(/Lançamentos identificados/).textContent)).toContain(
      norm("R$ 150,00"),
    );
  });

  it("desmarcar um lançamento atualiza a contagem", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByText(/2 selecionados/));

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    await waitFor(() => expect(screen.getByText(/1 selecionados/)).toBeInTheDocument());
  });

  it("desmarcar todos desabilita a confirmação", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByText(/2 selecionados/));

    for (const caixa of screen.getAllByRole("checkbox")) fireEvent.click(caixa);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled(),
    );
  });

  it("não oferece escolha de cartão principal quando há só um cartão", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => screen.getByText("SUPERMERCADO BH"));
    expect(screen.queryByText(/Cartão principal/)).not.toBeInTheDocument();
  });

  it("oferece escolha de cartão principal quando a fatura tem vários", async () => {
    comRespostas({
      parse: {
        body: {
          ...previewFatura,
          cards: [
            { holderName: "DAVID MATTAR", lastDigits: "8258" },
            { holderName: "MARIA SOUZA", lastDigits: "4321" },
          ],
        },
      },
    });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText(/Cartão principal/)).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "MARIA SOUZA — ****4321" })).toBeInTheDocument();
  });

  it("mostra o erro devolvido pela API de parse", async () => {
    comRespostas({ parse: { ok: false, body: { error: "Senha do PDF incorreta ou ausente." } } });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() =>
      expect(screen.getByText("Senha do PDF incorreta ou ausente.")).toBeInTheDocument(),
    );
  });

  it("usa mensagem genérica quando o parse falha sem detalhe", async () => {
    comRespostas({ parse: { ok: false, body: {} } });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByText("Erro ao processar o PDF.")).toBeInTheDocument());
  });

  it("avisa quando a conexão falha", async () => {
    comRespostas({ parseRejeita: true });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() =>
      expect(screen.getByText("Erro de conexão ao processar o PDF.")).toBeInTheDocument(),
    );
  });

  it("mostra 'Processando...' enquanto envia", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/categories") return { ok: true, json: async () => categorias };
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => previewFatura };
    });
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByRole("button", { name: "Processando..." })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByText("SUPERMERCADO BH")).toBeInTheDocument());
  });
});

describe("InvoiceImportPanel — confirmação", () => {
  async function chegarNoPreview(opcoes?: Parameters<typeof comRespostas>[0]) {
    comRespostas(opcoes);
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByText("SUPERMERCADO BH"));
  }

  it("envia os dados da fatura e só os lançamentos marcados", async () => {
    await chegarNoPreview();

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(chamada).toBeDefined();
      const corpo = JSON.parse(chamada![1].body);
      expect(corpo).toMatchObject({
        bank: "Santander",
        referenceMonth: "2026-08",
        totalAmount: 2829.29,
        minPayment: 282.92,
        fileName: "Fatura_082026.pdf",
        primaryCard: { holderName: "DAVID MATTAR", lastDigits: "8258" },
      });
      expect(corpo.transactions).toHaveLength(1);
      expect(corpo.transactions[0].description).toBe("SUPERMERCADO BH");
    });
  });

  it("envia null quando a fatura não tem vencimento nem pagamento mínimo", async () => {
    await chegarNoPreview({
      parse: { body: { ...previewFatura, dueDate: undefined, minPayment: undefined } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      const corpo = JSON.parse(chamada![1].body);
      expect(corpo.dueDate).toBeNull();
      expect(corpo.minPayment).toBeNull();
    });
  });

  it("permite trocar a categoria de um lançamento antes de confirmar", async () => {
    await chegarNoPreview();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "cat-outros" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).transactions[0].categoryId).toBe("cat-outros");
    });
  });

  it("permite deixar um lançamento sem categoria", async () => {
    await chegarNoPreview();

    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).transactions[0].categoryId).toBeNull();
    });
  });

  it("usa o cartão principal escolhido quando há vários", async () => {
    await chegarNoPreview({
      parse: {
        body: {
          ...previewFatura,
          cards: [
            { holderName: "DAVID MATTAR", lastDigits: "8258" },
            { holderName: "MARIA SOUZA", lastDigits: "4321" },
          ],
        },
      },
    });

    const seletorCartao = screen.getAllByRole("combobox")[0];
    fireEvent.change(seletorCartao, { target: { value: "MARIA SOUZA|4321" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).primaryCard).toEqual({
        holderName: "MARIA SOUZA",
        lastDigits: "4321",
      });
    });
  });

  it("mostra o resultado e permite importar outra fatura", async () => {
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() =>
      expect(screen.getByText(/2 transações importadas com sucesso/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Importar outra fatura" }));

    expect(screen.getByRole("button", { name: "Processar fatura" })).toBeInTheDocument();
  });

  it("mostra o erro devolvido pela API de confirmação", async () => {
    await chegarNoPreview({ confirm: { ok: false, body: { error: { fieldErrors: { bank: ["obrigatório"] } } } } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(screen.getByText(/obrigatório/)).toBeInTheDocument());
  });

  it("usa mensagem genérica quando a confirmação falha sem detalhe", async () => {
    await chegarNoPreview({ confirm: { ok: false, body: {} } });

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(screen.getByText("Erro ao salvar a fatura.")).toBeInTheDocument());
  });

  it("mostra 'Salvando...' enquanto grava", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/categories") return { ok: true, json: async () => categorias };
      if (url === "/api/invoices/parse") return { ok: true, json: async () => previewFatura };
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => ({ transactionsImported: 2 }) };
    });
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByText("SUPERMERCADO BH"));

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByText(/transações importadas/)).toBeInTheDocument());
  });
});

describe("InvoiceImportPanel — submissão sem arquivo", () => {
  it("submeter o formulário sem PDF não chama a API", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    fireEvent.submit(document.querySelector("form")!);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
