import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import BackupPanel from "@/components/BackupPanel";

let fetchMock: ReturnType<typeof vi.fn>;
let recarregar: ReturnType<typeof vi.fn>;

const backupValido = {
  formatVersion: 1,
  app: "FinancialController",
  generatedAt: "2026-08-29T15:00:00.000Z",
  counts: { categories: 17, transactions: 50 },
  data: { categories: [], transactions: [] },
};

/** Cria um `File` com o conteúdo informado, como o input de arquivo entrega. */
function arquivo(conteudo: string, nome = "backup.json"): File {
  return new File([conteudo], nome, { type: "application/json" });
}

/** Escolhe um arquivo no input (o mesmo que o usuário faria na tela). */
async function escolherArquivo(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return input;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      mode: "replace",
      inserted: { categories: 17 },
      totalInserted: 67,
      fileCounts: { categories: 17 },
    }),
  });
  vi.stubGlobal("fetch", fetchMock);
  recarregar = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: recarregar },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BackupPanel — fazer backup", () => {
  it("explica o propósito do bloco", () => {
    render(<BackupPanel />);

    expect(screen.getByText("Backup e restauração")).toBeInTheDocument();
    expect(screen.getByText(/identificadores são\s+preservados/)).toBeInTheDocument();
  });

  it("oferece o download apontando para a rota de export", () => {
    render(<BackupPanel />);

    const link = screen.getByRole("link", { name: "Baixar backup (JSON)" });
    expect(link).toHaveAttribute("href", "/api/backup/export");
  });

  it("lista o que entra no backup", () => {
    render(<BackupPanel />);

    expect(screen.getByText(/Transações Família/)).toBeInTheDocument();
    expect(screen.getByText(/diárias customizadas/)).toBeInTheDocument();
  });
});

describe("BackupPanel — escolher o arquivo (etapa de preview)", () => {
  it("mostra o resumo do arquivo antes de qualquer gravação", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo(JSON.stringify(backupValido)));

    await waitFor(() => expect(screen.getByText(/67 registros no arquivo/)).toBeInTheDocument());
    expect(screen.getByText("backup.json", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/gerado em/)).toBeInTheDocument();
    expect(screen.getByText("Categorias")).toBeInTheDocument();
    expect(screen.getByText("Transações")).toBeInTheDocument();
    // Nada foi enviado ao servidor ainda.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conta os registros direto de data quando o arquivo não tem counts", async () => {
    const semCounts = {
      formatVersion: 1,
      data: { categories: [{ id: "c1" }, { id: "c2" }], transactions: [{ id: "t1" }] },
    };

    render(<BackupPanel />);
    await escolherArquivo(arquivo(JSON.stringify(semCounts)));

    await waitFor(() => expect(screen.getByText(/3 registros no arquivo/)).toBeInTheDocument());
  });

  it("usa singular quando o arquivo tem um único registro", async () => {
    render(<BackupPanel />);

    await escolherArquivo(
      arquivo(JSON.stringify({ formatVersion: 1, counts: { categories: 1 }, data: { categories: [{}] } })),
    );

    await waitFor(() => expect(screen.getByText(/1 registro no arquivo/)).toBeInTheDocument());
  });

  it("só lista as tabelas que têm registro", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo(JSON.stringify(backupValido)));

    await waitFor(() => expect(screen.getByText("Categorias")).toBeInTheDocument());
    expect(screen.queryByText("Faturas")).not.toBeInTheDocument();
  });

  it("recusa arquivo que não é JSON", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo("isso não é json", "foto.json"));

    await waitFor(() =>
      expect(screen.getByText(/não é um JSON válido/)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Restaurar backup" })).not.toBeInTheDocument();
  });

  it("recusa JSON que não tem cara de backup", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo(JSON.stringify({ foo: "bar" })));

    await waitFor(() =>
      expect(screen.getByText(/não parece ser um backup gerado por este app/)).toBeInTheDocument(),
    );
  });

  it("recusa JSON nulo", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo("null"));

    await waitFor(() =>
      expect(screen.getByText(/não parece ser um backup gerado por este app/)).toBeInTheDocument(),
    );
  });

  it("recusa backup sem a seção de dados", async () => {
    render(<BackupPanel />);

    await escolherArquivo(arquivo(JSON.stringify({ formatVersion: 1, data: null })));

    await waitFor(() =>
      expect(screen.getByText(/não parece ser um backup gerado por este app/)).toBeInTheDocument(),
    );
  });

  it("limpar a seleção volta ao estado inicial", async () => {
    render(<BackupPanel />);
    await escolherArquivo(arquivo(JSON.stringify(backupValido)));
    await waitFor(() => screen.getByText(/67 registros/));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });

    await waitFor(() => expect(screen.queryByText(/67 registros/)).not.toBeInTheDocument());
  });
});

describe("BackupPanel — modos de restauração", () => {
  beforeEach(async () => {
    render(<BackupPanel />);
    await escolherArquivo(arquivo(JSON.stringify(backupValido)));
    await waitFor(() => screen.getByText(/67 registros/));
  });

  it("oferece os dois modos, com 'Substituir tudo' pré-selecionado", () => {
    const substituir = screen.getByRole("radio", { name: /Substituir tudo/ });
    const adicionar = screen.getByRole("radio", { name: /Só adicionar o que falta/ });

    expect(substituir).toBeChecked();
    expect(adicionar).not.toBeChecked();
  });

  it("explica o que cada modo faz", () => {
    expect(screen.getByText(/Apaga os dados atuais/)).toBeInTheDocument();
    expect(screen.getByText(/Mantém os dados atuais/)).toBeInTheDocument();
  });

  it("permite trocar para o modo de só adicionar", () => {
    fireEvent.click(screen.getByRole("radio", { name: /Só adicionar o que falta/ }));

    expect(screen.getByRole("radio", { name: /Só adicionar o que falta/ })).toBeChecked();
  });
});

describe("BackupPanel — confirmação e restauração", () => {
  async function abrirConfirmacao(modo?: "merge") {
    render(<BackupPanel />);
    await escolherArquivo(arquivo(JSON.stringify(backupValido)));
    await waitFor(() => screen.getByText(/67 registros/));
    if (modo === "merge") {
      fireEvent.click(screen.getByRole("radio", { name: /Só adicionar o que falta/ }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Restaurar backup" }));
  }

  it("pede confirmação antes de substituir tudo, avisando que não há como desfazer", async () => {
    await abrirConfirmacao();

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Substituir todos os dados?")).toBeInTheDocument();
    expect(screen.getByText(/Não há como desfazer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apagar e restaurar" })).toBeInTheDocument();
    // Ainda não gravou nada.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a confirmação do modo merge é mais branda", async () => {
    await abrirConfirmacao("merge");

    expect(screen.getByText("Adicionar os dados que faltam?")).toBeInTheDocument();
    expect(screen.getByText(/mantendo tudo o que já existe/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar" })).toBeInTheDocument();
  });

  it("cancelar a confirmação não grava nada", async () => {
    await abrirConfirmacao();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("confirmar envia o arquivo com o modo escolhido", async () => {
    await abrirConfirmacao();

    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/backup/restore?mode=replace");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(backupValido);
  });

  it("envia mode=merge quando esse modo foi escolhido", async () => {
    await abrirConfirmacao("merge");

    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls[0][0]).toBe("/api/backup/restore?mode=merge"),
    );
  });

  it("mostra o resultado e oferece recarregar a página", async () => {
    await abrirConfirmacao();

    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() =>
      expect(screen.getByText(/67 registros inseridos/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Recarregar a página" }));
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("avisa no modo merge que os existentes foram mantidos", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ mode: "merge", inserted: {}, totalInserted: 3, fileCounts: {} }),
    });

    await abrirConfirmacao("merge");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await waitFor(() =>
      expect(screen.getByText(/os que já existiam foram mantidos/)).toBeInTheDocument(),
    );
  });

  it("usa singular no resultado de um único registro", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ mode: "replace", inserted: {}, totalInserted: 1, fileCounts: {} }),
    });

    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(screen.getByText(/1 registro inserido/)).toBeInTheDocument());
  });

  it("limpa o arquivo escolhido depois de restaurar", async () => {
    await abrirConfirmacao();

    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(screen.getByText(/registros inseridos/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Restaurar backup" })).not.toBeInTheDocument();
  });

  it("mostra o erro devolvido pela API", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "A restauração falhou e NADA foi alterado no banco." }),
    });

    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(screen.getByText(/NADA foi alterado/)).toBeInTheDocument());
    // O arquivo continua selecionado para o usuário tentar de novo.
    expect(screen.getByRole("button", { name: "Restaurar backup" })).toBeInTheDocument();
  });

  it("usa mensagem genérica quando a API falha sem detalhar", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(screen.getByText("Erro ao restaurar o backup.")).toBeInTheDocument());
  });

  it("avisa quando a conexão falha", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() =>
      expect(screen.getByText("Erro de conexão ao restaurar o backup.")).toBeInTheDocument(),
    );
  });

  it("desabilita os controles enquanto restaura", async () => {
    let liberar: () => void = () => {};
    fetchMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        liberar = resolve;
      });
      return { ok: true, json: async () => ({ mode: "replace", inserted: {}, totalInserted: 0, fileCounts: {} }) };
    });

    await abrirConfirmacao();
    fireEvent.click(screen.getByRole("button", { name: "Apagar e restaurar" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Restaurando..." })).toBeDisabled());
    liberar();
    await waitFor(() => expect(screen.getByText(/registro/)).toBeInTheDocument());
  });
});

describe("BackupPanel — voltar para o modo de substituir", () => {
  it("dá para voltar de 'só adicionar' para 'substituir tudo'", async () => {
    render(<BackupPanel />);
    await escolherArquivo(arquivo(JSON.stringify(backupValido)));
    await waitFor(() => screen.getByText(/67 registros/));

    fireEvent.click(screen.getByRole("radio", { name: /Só adicionar o que falta/ }));
    expect(screen.getByRole("radio", { name: /Só adicionar o que falta/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Substituir tudo/ }));

    expect(screen.getByRole("radio", { name: /Substituir tudo/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar backup" }));
    expect(screen.getByText("Substituir todos os dados?")).toBeInTheDocument();
  });
});
