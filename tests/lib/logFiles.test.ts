import { beforeEach, describe, expect, it, vi } from "vitest";

// O módulo grava em disco de verdade; o mock troca as duas únicas funções de
// I/O que ele usa, para o teste poder verificar QUAIS arquivos seriam escritos
// sem criar pasta nenhuma.
vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import {
  appendLogEvents,
  dayDir,
  ERROR_LOG_NAME,
  LOG_DIR_NAME,
  logRoot,
  safeSlug,
} from "@/lib/logFiles";
import type { LogEvent } from "@/lib/logEvents";

const append = vi.mocked(appendFile);
const criarPasta = vi.mocked(mkdir);

beforeEach(() => {
  append.mockClear();
  criarPasta.mockClear();
});

function evento(over: Partial<LogEvent> = {}): LogEvent {
  return {
    at: "2026-08-31T18:05:02.000Z",
    tab: "transacoes",
    level: "info",
    action: "gravou",
    detail: "criou transação",
    ...over,
  };
}

/** Os arquivos que foram escritos, com o conteúdo, indexados pelo caminho. */
function escritos(): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [destino, conteudo] of append.mock.calls) {
    r[String(destino)] = String(conteudo);
  }
  return r;
}

describe("caminhos", () => {
  it("a pasta de logs fica na raiz do projeto", () => {
    expect(logRoot()).toBe(path.join(process.cwd(), LOG_DIR_NAME));
    expect(LOG_DIR_NAME).toBe("logs");
  });

  it("a pasta do dia usa a data local", () => {
    // 01/09 02:30 UTC ainda é 31/08 em Brasília (ver logEvents.test.ts).
    expect(dayDir(new Date("2026-09-01T02:30:00.000Z"))).toBe(
      path.join(logRoot(), "2026-08-31"),
    );
  });
});

describe("safeSlug", () => {
  it("mantém slug válido", () => {
    expect(safeSlug("transacoes-familia")).toBe("transacoes-familia");
  });

  it("slug inválido vai para o arquivo de rota desconhecida, não é descartado", () => {
    // O requisito é que nada fique sem registro — nem um evento com aba
    // estranha (ou maliciosa, tentando escapar da pasta).
    expect(safeSlug("../../etc/passwd")).toBe("outras-rotas");
    expect(safeSlug("")).toBe("outras-rotas");
    expect(safeSlug("Com Espaço")).toBe("outras-rotas");
  });
});

describe("appendLogEvents", () => {
  it("cria a pasta do dia automaticamente, e não reclama se já existe", async () => {
    await appendLogEvents([evento()]);

    expect(criarPasta).toHaveBeenCalledWith(dayDir(new Date("2026-08-31T18:05:02.000Z")), {
      recursive: true,
    });
  });

  it("grava a movimentação no arquivo da aba", async () => {
    await appendLogEvents([evento()]);

    const arquivos = escritos();
    const destino = path.join(dayDir(new Date("2026-08-31T18:05:02.000Z")), "transacoes.log");
    expect(arquivos[destino]).toContain("criou transação");
    expect(arquivos[destino].endsWith("\n")).toBe(true);
  });

  it("um erro é gravado NOS DOIS arquivos: o da aba e o de erros", async () => {
    // É o "nada fica sem registro": nenhum dos dois, lido isolado, esconde o erro.
    await appendLogEvents([evento({ level: "error", detail: "falhou" })]);

    const dir = dayDir(new Date("2026-08-31T18:05:02.000Z"));
    const arquivos = escritos();
    expect(arquivos[path.join(dir, "transacoes.log")]).toContain("falhou");
    expect(arquivos[path.join(dir, ERROR_LOG_NAME)]).toContain("falhou");
    expect(ERROR_LOG_NAME).toBe("erros.log");
  });

  it("movimentação normal NÃO entra no log de erros", async () => {
    await appendLogEvents([evento()]);

    const dir = dayDir(new Date("2026-08-31T18:05:02.000Z"));
    expect(escritos()[path.join(dir, ERROR_LOG_NAME)]).toBeUndefined();
  });

  it("agrupa por arquivo: um appendFile por arquivo, não um por linha", async () => {
    await appendLogEvents([
      evento({ detail: "primeira" }),
      evento({ detail: "segunda" }),
      evento({ detail: "terceira" }),
    ]);

    expect(append).toHaveBeenCalledTimes(1);
    const conteudo = Object.values(escritos())[0];
    expect(conteudo.trim().split("\n")).toHaveLength(3);
  });

  it("separa abas diferentes em arquivos diferentes", async () => {
    await appendLogEvents([
      evento({ tab: "transacoes" }),
      evento({ tab: "investimentos" }),
    ]);

    const dir = dayDir(new Date("2026-08-31T18:05:02.000Z"));
    const arquivos = escritos();
    expect(arquivos[path.join(dir, "transacoes.log")]).toBeDefined();
    expect(arquivos[path.join(dir, "investimentos.log")]).toBeDefined();
  });

  it("separa dias diferentes em pastas diferentes", async () => {
    await appendLogEvents([
      evento({ at: "2026-08-31T12:00:00.000Z" }),
      evento({ at: "2026-09-01T12:00:00.000Z" }),
    ]);

    const pastas = criarPasta.mock.calls.map((c) => String(c[0]));
    expect(pastas).toContain(path.join(logRoot(), "2026-08-31"));
    expect(pastas).toContain(path.join(logRoot(), "2026-09-01"));
  });

  it("mantém a ordem das linhas dentro do arquivo", async () => {
    await appendLogEvents([evento({ detail: "antes" }), evento({ detail: "depois" })]);

    const conteudo = Object.values(escritos())[0];
    expect(conteudo.indexOf("antes")).toBeLessThan(conteudo.indexOf("depois"));
  });

  it("grava em UTF-8 (o log tem acento e travessão)", async () => {
    await appendLogEvents([evento()]);
    expect(append.mock.calls[0][2]).toBe("utf8");
  });

  it("lote vazio não toca em disco", async () => {
    const r = await appendLogEvents([]);

    expect(r).toEqual({});
    expect(criarPasta).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it("devolve a contagem de linhas por arquivo", async () => {
    const r = await appendLogEvents([
      evento({ detail: "a" }),
      evento({ detail: "b" }),
      evento({ level: "error", detail: "c" }),
    ]);

    expect(r[path.join("2026-08-31", "transacoes.log")]).toBe(3);
    expect(r[path.join("2026-08-31", ERROR_LOG_NAME)]).toBe(1);
  });

  it("aba com slug inválido ainda gera arquivo", async () => {
    await appendLogEvents([evento({ tab: "rota/estranha" })]);

    const dir = dayDir(new Date("2026-08-31T18:05:02.000Z"));
    expect(escritos()[path.join(dir, "outras-rotas.log")]).toBeDefined();
  });

  it("propaga falha de disco para a rota poder responder 500", async () => {
    // Silenciar aqui esconderia justamente o caso "o log parou de funcionar".
    append.mockRejectedValueOnce(new Error("EACCES: permission denied"));

    await expect(appendLogEvents([evento()])).rejects.toThrow("EACCES");
  });
});
