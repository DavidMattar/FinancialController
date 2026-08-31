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

/** O input de descrição do lançamento na posição `n` (1-based) da tabela de revisão. */
function campoDescricao(n: number): HTMLInputElement {
  return screen.getByLabelText(`Descrição do lançamento ${n}`) as HTMLInputElement;
}

/**
 * A linha (`<tr>`) do lançamento na posição `n` (1-based) da tabela de revisão.
 * Localizada pelo input de descrição, já que a descrição não é mais texto solto.
 */
function linhaDoLancamento(n: number): HTMLTableRowElement {
  return campoDescricao(n).closest("tr")!;
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

    await waitFor(() => expect(screen.getByDisplayValue("SUPERMERCADO BH")).toBeInTheDocument());
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
    expect(screen.getByText(/parcela 2\/10/)).toBeInTheDocument();
  });

  it("mostra sinal negativo em lançamento que não é despesa", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => expect(screen.getByDisplayValue("PAGAMENTO DE FATURA")).toBeInTheDocument());
    const linha = screen.getByDisplayValue("PAGAMENTO DE FATURA").closest("tr")!;
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

    // Cada linha tem DOIS checkboxes (incluir e "verificar devolução"), então o
    // índice achatado não serve para escolher o de incluir de uma linha
    // específica — o primeiro checkbox da linha é sempre o de incluir.
    fireEvent.click(linhaDoLancamento(1).querySelectorAll("input[type=checkbox]")[0]);

    await waitFor(() => expect(screen.getByText(/1 selecionados/)).toBeInTheDocument());
  });

  it("desmarcar todos desabilita a confirmação", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByText(/2 selecionados/));

    for (const n of [1, 2]) {
      fireEvent.click(linhaDoLancamento(n).querySelectorAll("input[type=checkbox]")[0]);
    }

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled(),
    );
  });

  it("não oferece escolha de cartão principal quando há só um cartão", async () => {
    comRespostas();
    render(<InvoiceImportPanel />);

    processarPdf();

    await waitFor(() => screen.getByDisplayValue("SUPERMERCADO BH"));
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
    await waitFor(() => expect(screen.getByDisplayValue("SUPERMERCADO BH")).toBeInTheDocument());
  });
});

describe("InvoiceImportPanel — confirmação", () => {
  async function chegarNoPreview(opcoes?: Parameters<typeof comRespostas>[0]) {
    comRespostas(opcoes);
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByDisplayValue("SUPERMERCADO BH"));
  }

  it("envia os dados da fatura e só os lançamentos marcados", async () => {
    await chegarNoPreview();

    fireEvent.click(linhaDoLancamento(2).querySelectorAll("input[type=checkbox]")[0]);
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
    await waitFor(() => screen.getByDisplayValue("SUPERMERCADO BH"));

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

/**
 * A descrição de cada lançamento é editável na própria tela de revisão, porque
 * o texto que vem da fatura é o do adquirente e muitas vezes não diz nada. O
 * que importa nos testes: o texto editado é o que vai para a API, a original
 * continua recuperável, e descrição vazia não passa (a rota de confirmação
 * exige `min(1)`).
 */
describe("InvoiceImportPanel — editar a descrição do lançamento", () => {
  async function chegarNoPreview() {
    comRespostas();
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByDisplayValue("SUPERMERCADO BH"));
  }

  it("abre com a descrição que veio da fatura", async () => {
    await chegarNoPreview();

    expect(campoDescricao(1)).toHaveValue("SUPERMERCADO BH");
    expect(campoDescricao(2)).toHaveValue("PAGAMENTO DE FATURA");
  });

  it("envia a descrição editada, não a original da fatura", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "Feira da semana" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      const corpo = JSON.parse(chamada![1].body);
      expect(corpo.transactions[0].description).toBe("Feira da semana");
    });
  });

  it("apara espaços da descrição antes de enviar", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "  Feira  " } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).transactions[0].description).toBe("Feira");
    });
  });

  it("não envia a descrição original como campo extra (é estado só da tela)", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "Feira" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).transactions[0]).not.toHaveProperty("parsedDescription");
    });
  });

  it("editar um lançamento não mexe nos outros", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "Feira" } });

    expect(campoDescricao(2)).toHaveValue("PAGAMENTO DE FATURA");
  });

  it("destaca o campo e libera o restaurar só quando a descrição foi alterada", async () => {
    await chegarNoPreview();

    const restaurar = screen.getByLabelText("Restaurar descrição original do lançamento 1");
    expect(restaurar).toBeDisabled();
    expect(campoDescricao(1).className).not.toContain("border-amber-300");

    fireEvent.change(campoDescricao(1), { target: { value: "Feira" } });

    expect(restaurar).not.toBeDisabled();
    expect(campoDescricao(1).className).toContain("border-amber-300");
  });

  it("restaurar devolve a descrição original da fatura", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "Feira" } });
    fireEvent.click(screen.getByLabelText("Restaurar descrição original do lançamento 1"));

    expect(campoDescricao(1)).toHaveValue("SUPERMERCADO BH");
    expect(screen.getByLabelText("Restaurar descrição original do lançamento 1")).toBeDisabled();
  });

  it("mostra a descrição original no title quando o campo foi editado", async () => {
    await chegarNoPreview();

    expect(campoDescricao(1).title).toBe("SUPERMERCADO BH");

    fireEvent.change(campoDescricao(1), { target: { value: "Feira" } });

    expect(campoDescricao(1).title).toBe("Original na fatura: SUPERMERCADO BH");
  });

  it("bloqueia a confirmação enquanto um lançamento incluído está sem descrição", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled();
    expect(screen.getByText(/está sem descrição/)).toBeInTheDocument();
  });

  it("descrição só com espaços conta como vazia", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled();
  });

  it("usa o plural no aviso quando são vários sem descrição", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(1), { target: { value: "" } });
    fireEvent.change(campoDescricao(2), { target: { value: "" } });

    expect(screen.getByText(/2 lançamentos selecionados estão sem descrição/)).toBeInTheDocument();
  });

  it("desmarcar o lançamento sem descrição libera a confirmação", async () => {
    await chegarNoPreview();

    fireEvent.change(campoDescricao(2), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled();

    // O primeiro checkbox da linha é o de incluir/excluir o lançamento.
    fireEvent.click(linhaDoLancamento(2).querySelectorAll("input[type=checkbox]")[0]);

    expect(screen.getByRole("button", { name: "Confirmar importação" })).not.toBeDisabled();
    expect(screen.queryByText(/está sem descrição/)).not.toBeInTheDocument();
  });
});

/**
 * O checkbox "Dev." marca o lançamento como pendente de verificação de
 * devolução já na criação — evita ter que abrir cada transação depois de
 * importar. Sem a trava de e-commerce que o painel da transação existente usa:
 * na revisão da fatura, quem decide é o usuário.
 */
describe("InvoiceImportPanel — marcar devolução na revisão", () => {
  async function chegarNoPreview() {
    comRespostas();
    render(<InvoiceImportPanel />);
    processarPdf();
    await waitFor(() => screen.getByDisplayValue("SUPERMERCADO BH"));
  }

  it("começa desmarcado em todos os lançamentos", async () => {
    await chegarNoPreview();

    expect(screen.getByLabelText("Verificar devolução do lançamento 1")).not.toBeChecked();
    expect(screen.getByLabelText("Verificar devolução do lançamento 2")).not.toBeChecked();
  });

  it("envia pendingReturn true só no lançamento marcado", async () => {
    await chegarNoPreview();

    fireEvent.click(screen.getByLabelText("Verificar devolução do lançamento 1"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      const corpo = JSON.parse(chamada![1].body);
      expect(corpo.transactions[0].pendingReturn).toBe(true);
      expect(corpo.transactions[1].pendingReturn).toBe(false);
    });
  });

  it("aparece em qualquer lançamento, não só nos de e-commerce", async () => {
    // "SUPERMERCADO BH" e "PAGAMENTO DE FATURA" não estão em ecommerceMerchants.ts
    // e mesmo assim têm o checkbox — a trava de e-commerce vale só para o painel
    // da transação já criada.
    await chegarNoPreview();

    expect(screen.getByLabelText("Verificar devolução do lançamento 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Verificar devolução do lançamento 2")).toBeInTheDocument();
  });

  it("desmarcar volta a enviar false", async () => {
    await chegarNoPreview();

    const check = screen.getByLabelText("Verificar devolução do lançamento 1");
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/invoices/confirm");
      expect(JSON.parse(chamada![1].body).transactions[0].pendingReturn).toBe(false);
    });
  });

  it("conta os marcados no cabeçalho da lista", async () => {
    await chegarNoPreview();

    expect(screen.queryByText(/p\/ verificar devolução/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Verificar devolução do lançamento 1"));

    expect(screen.getByText(/1 p\/ verificar devolução/)).toBeInTheDocument();
  });
});
