import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReceiptImportPanel from "@/components/ReceiptImportPanel";
import { normalizarEspacos as norm } from "../helpers/text";

let fetchMock: ReturnType<typeof vi.fn>;

const previewNota = {
  storeName: "SUPERMERCADO BH LTDA",
  cnpj: "12.345.678/0001-90",
  date: "2026-08-15T19:42:07.000Z",
  officialTotal: 29.88,
  computedTotal: 29.88,
  suggestedCategoryId: "cat-super",
  items: [
    { description: "ARROZ TIPO 1 5KG", code: "123", quantity: 1, unit: "UN", amount: 25.9 },
    { description: "BANANA PRATA KG", code: "456", quantity: 1.58, unit: "KG", amount: 3.98 },
  ],
};

const categorias = [
  { id: "cat-super", name: "Supermercado" },
  { id: "cat-outros", name: "Outros" },
];

/**
 * Configura as três rotas usadas pelo painel: categorias, parse e confirm.
 * `parse` e `confirm` aceitam sobrescrita para testar erro.
 */
function comRespostas(opcoes: {
  parse?: { ok?: boolean; body?: unknown };
  confirm?: { ok?: boolean; body?: unknown };
  parseRejeita?: boolean;
  confirmRejeita?: boolean;
} = {}) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/categories") return { ok: true, json: async () => categorias };
    if (url === "/api/receipts/parse") {
      if (opcoes.parseRejeita) throw new Error("network");
      return {
        ok: opcoes.parse?.ok ?? true,
        json: async () => opcoes.parse?.body ?? previewNota,
      };
    }
    if (url === "/api/receipts/confirm") {
      if (opcoes.confirmRejeita) throw new Error("network");
      return {
        ok: opcoes.confirm?.ok ?? true,
        json: async () => opcoes.confirm?.body ?? { itemsImported: 2, totalAmount: 29.88 },
      };
    }
    throw new Error(`rota inesperada: ${url}`);
  });
}

/** Preenche o texto colado e processa a nota. */
async function processarTexto(texto = "Nota Fiscal de Consumidor Eletrônica") {
  fireEvent.change(screen.getByPlaceholderText(/Cole aqui o texto/), {
    target: { value: texto },
  });
  fireEvent.click(screen.getByRole("button", { name: "Processar nota fiscal" }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReceiptImportPanel — formulário inicial", () => {
  it("explica o formato aceito e que os itens são apenas visuais", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    expect(screen.getByText(/Suporta notas NFC-e \(Sefaz\)/)).toBeInTheDocument();
    expect(screen.getByText(/não entra em relatórios/)).toBeInTheDocument();
  });

  it("o botão fica desabilitado até informar arquivo ou texto", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const botao = screen.getByRole("button", { name: "Processar nota fiscal" });
    expect(botao).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Cole aqui o texto/), {
      target: { value: "algum texto" },
    });
    expect(botao).not.toBeDisabled();
  });

  it("texto só com espaços não habilita o botão", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    fireEvent.change(screen.getByPlaceholderText(/Cole aqui o texto/), {
      target: { value: "   " },
    });

    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).toBeDisabled();
  });

  it("escolher arquivo limpa o texto colado (as duas entradas são exclusivas)", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const textarea = screen.getByPlaceholderText(/Cole aqui o texto/);
    fireEvent.change(textarea, { target: { value: "texto qualquer" } });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "nota.pdf", { type: "application/pdf" })] },
    });

    expect(textarea).toHaveValue("");
  });

  it("digitar texto limpa o arquivo escolhido", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "nota.pdf", { type: "application/pdf" })] },
    });
    fireEvent.change(screen.getByPlaceholderText(/Cole aqui o texto/), {
      target: { value: "texto" },
    });

    // Sem arquivo e com texto, o botão continua habilitado.
    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).not.toBeDisabled();
  });

  it("limpar a seleção de arquivo não quebra", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).toBeDisabled();
  });
});

describe("ReceiptImportPanel — etapa de preview", () => {
  it("envia o texto colado e mostra os dados da nota", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByText("SUPERMERCADO BH LTDA")).toBeInTheDocument());
    expect(screen.getByText("ARROZ TIPO 1 5KG")).toBeInTheDocument();
    expect(screen.getByText("BANANA PRATA KG")).toBeInTheDocument();
    expect(norm(document.body.textContent)).toContain(norm("R$ 29,88"));
  });

  it("carrega as categorias para o seletor", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/categories"));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Supermercado" })).toBeInTheDocument(),
    );
  });

  it("pré-seleciona a categoria sugerida", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("cat-super"),
    );
  });

  it("deixa a categoria vazia quando não há sugestão", async () => {
    comRespostas({ parse: { body: { ...previewNota, suggestedCategoryId: null } } });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(""),
    );
  });

  it("usa a data da nota no campo de data", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByDisplayValue("2026-08-15")).toBeInTheDocument());
  });

  it("cai na data de hoje quando a nota não trazia data", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 20, 12, 0, 0)));
    comRespostas({ parse: { body: { ...previewNota, date: null } } });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByDisplayValue("2026-08-20")).toBeInTheDocument());
    vi.useRealTimers();
  });

  it("todos os itens começam selecionados, com a soma no título", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByText(/2 selecionados/)).toBeInTheDocument());
    const titulo = screen.getByText(/Itens identificados/);
    expect(norm(titulo.textContent)).toContain(norm("R$ 29,88"));
    for (const caixa of screen.getAllByRole("checkbox")) expect(caixa).toBeChecked();
  });

  it("desmarcar um item recalcula a contagem e o total", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);
    await processarTexto();
    await waitFor(() => screen.getByText(/2 selecionados/));

    fireEvent.click(screen.getAllByRole("checkbox")[1]);

    await waitFor(() => expect(screen.getByText(/1 selecionados/)).toBeInTheDocument());
    expect(norm(screen.getByText(/Itens identificados/).textContent)).toContain(norm("R$ 25,90"));
  });

  it("desmarcar todos desabilita a confirmação", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);
    await processarTexto();
    await waitFor(() => screen.getByText(/2 selecionados/));

    for (const caixa of screen.getAllByRole("checkbox")) fireEvent.click(caixa);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Confirmar importação" })).toBeDisabled(),
    );
  });

  it("mostra quantidade e unidade de cada item", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByText("1 UN")).toBeInTheDocument());
    expect(screen.getByText("1.58 KG")).toBeInTheDocument();
  });

  it("mostra o erro devolvido pela API de parse", async () => {
    comRespostas({ parse: { ok: false, body: { error: "Formato ainda não suportado." } } });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByText("Formato ainda não suportado.")).toBeInTheDocument());
  });

  it("usa mensagem genérica quando a API não detalha o erro", async () => {
    comRespostas({ parse: { ok: false, body: {} } });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() =>
      expect(screen.getByText("Erro ao processar a nota fiscal.")).toBeInTheDocument(),
    );
  });

  it("avisa quando a conexão falha", async () => {
    comRespostas({ parseRejeita: true });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() =>
      expect(screen.getByText("Erro de conexão ao processar a nota fiscal.")).toBeInTheDocument(),
    );
  });

  it("mostra 'Processando...' enquanto envia", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/categories") return { ok: true, json: async () => categorias };
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => previewNota };
    });
    render(<ReceiptImportPanel />);

    await processarTexto();

    await waitFor(() => expect(screen.getByRole("button", { name: "Processando..." })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByText("SUPERMERCADO BH LTDA")).toBeInTheDocument());
  });
});

describe("ReceiptImportPanel — confirmação", () => {
  async function chegarNoPreview() {
    render(<ReceiptImportPanel />);
    await processarTexto();
    await waitFor(() => screen.getByText("SUPERMERCADO BH LTDA"));
  }

  it("envia data, loja, categoria e só os itens marcados", async () => {
    comRespostas();
    await chegarNoPreview();

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/receipts/confirm");
      expect(chamada).toBeDefined();
      expect(JSON.parse(chamada![1].body)).toEqual({
        date: "2026-08-15",
        storeName: "SUPERMERCADO BH LTDA",
        categoryId: "cat-super",
        items: [{ description: "ARROZ TIPO 1 5KG", amount: 25.9 }],
      });
    });
  });

  it("envia categoria nula quando nenhuma está escolhida", async () => {
    comRespostas({ parse: { body: { ...previewNota, suggestedCategoryId: null } } });
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/receipts/confirm");
      expect(JSON.parse(chamada![1].body).categoryId).toBeNull();
    });
  });

  it("permite trocar a categoria antes de confirmar", async () => {
    comRespostas();
    await chegarNoPreview();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cat-outros" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/receipts/confirm");
      expect(JSON.parse(chamada![1].body).categoryId).toBe("cat-outros");
    });
  });

  it("permite corrigir a data antes de confirmar", async () => {
    comRespostas();
    await chegarNoPreview();

    fireEvent.change(screen.getByDisplayValue("2026-08-15"), { target: { value: "2026-08-16" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/receipts/confirm");
      expect(JSON.parse(chamada![1].body).date).toBe("2026-08-16");
    });
  });

  it("mostra o resultado e permite importar outra nota", async () => {
    comRespostas();
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() =>
      expect(screen.getByText(/Transação criada com 2 itens/)).toBeInTheDocument(),
    );
    expect(norm(screen.getByText(/Transação criada/).textContent)).toContain(norm("R$ 29,88"));

    fireEvent.click(screen.getByRole("button", { name: "Importar outra nota" }));

    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).toBeInTheDocument();
  });

  it("mostra o erro devolvido pela API de confirmação", async () => {
    comRespostas({ confirm: { ok: false, body: { error: { fieldErrors: { items: ["obrigatório"] } } } } });
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(screen.getByText(/obrigatório/)).toBeInTheDocument());
  });

  it("usa mensagem genérica quando a confirmação falha sem detalhe", async () => {
    comRespostas({ confirm: { ok: false, body: {} } });
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() =>
      expect(screen.getByText("Erro ao salvar a nota fiscal.")).toBeInTheDocument(),
    );
  });

  it("mostra 'Salvando...' enquanto grava", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/categories") return { ok: true, json: async () => categorias };
      if (url === "/api/receipts/parse") return { ok: true, json: async () => previewNota };
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => ({ itemsImported: 2, totalAmount: 29.88 }) };
    });
    await chegarNoPreview();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar importação" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvando..." })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByText(/Transação criada/)).toBeInTheDocument());
  });
});

describe("ReceiptImportPanel — submissão sem conteúdo", () => {
  it("submeter o formulário vazio não chama a API", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    fireEvent.submit(document.querySelector("form")!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("apagar o texto colado volta a desabilitar o botão", () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const textarea = screen.getByPlaceholderText(/Cole aqui o texto/);
    // Precisa digitar antes: o React não dispara onChange quando o valor não
    // muda, então "apagar" um campo já vazio não exercitaria nada.
    fireEvent.change(textarea, { target: { value: "rascunho" } });
    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).not.toBeDisabled();

    // Ao apagar, o componente NÃO mexe no arquivo escolhido (só um texto de
    // verdade descarta o arquivo) — e sem nenhuma das duas entradas o botão
    // volta a ficar travado.
    fireEvent.change(textarea, { target: { value: "" } });

    expect(screen.getByRole("button", { name: "Processar nota fiscal" })).toBeDisabled();
  });

  it("processa a nota a partir de um arquivo PDF escolhido", async () => {
    comRespostas();
    render(<ReceiptImportPanel />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["pdf"], "nota.pdf", { type: "application/pdf" })] },
    });
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find((c) => c[0] === "/api/receipts/parse");
      expect(chamada).toBeDefined();
      const form = chamada![1].body as FormData;
      // Com arquivo, é o PDF que vai no formulário — não o campo de texto.
      expect(form.get("file")).toBeInstanceOf(File);
      expect(form.get("text")).toBeNull();
    });
    await waitFor(() => expect(screen.getByText("SUPERMERCADO BH LTDA")).toBeInTheDocument());
  });
});
