import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ExplainedError } from "@/lib/errorExplain";
import {
  installFetchMonitor,
  installGlobalErrorHandlers,
  logNavigation,
  LOG_ENDPOINT,
  POPUP_MUTED_PATHS,
  resetNavigationMemory,
} from "@/lib/logClient";

/**
 * Este arquivo vive em `tests/client/` (e não em `tests/lib/`) porque o módulo
 * troca `window.fetch` e escuta eventos de `window`: precisa do jsdom, que só o
 * projeto "dom" do Vitest fornece. Ver o comentário no `vitest.config.mts`.
 */

/** O fetch original, dublado — é ele que o invólucro deve chamar por baixo. */
let baseFetch: ReturnType<typeof vi.fn>;
// Tipado com a assinatura real de `report`, e nao com o `vi.fn()` cru: sem
// isso o TypeScript recusa passar o dublê para `installFetchMonitor`.
let report: Mock<(error: ExplainedError) => void>;
let desinstalar: (() => void)[] = [];

/** Resposta dublada, com `clone()` porque o invólucro clona antes de ler o corpo. */
function resposta(status: number, body: unknown = null): Response {
  const texto = body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const r = {
    ok: status >= 200 && status < 300,
    status,
    clone: () => ({ text: async () => texto }),
  };
  return r as unknown as Response;
}

/**
 * Os eventos que o INTERCEPTADOR enviou para a rota de log.
 *
 * O filtro por `events` importa: um teste chama `window.fetch(LOG_ENDPOINT)`
 * direto, com outro corpo, e essa chamada não é um evento gravado.
 */
function eventosGravados(): Record<string, unknown>[] {
  return baseFetch.mock.calls
    .filter((c) => c[0] === LOG_ENDPOINT)
    .flatMap((c) => {
      const corpo = JSON.parse(String(c[1].body));
      return Array.isArray(corpo.events) ? (corpo.events as Record<string, unknown>[]) : [];
    });
}

beforeEach(() => {
  baseFetch = vi.fn(async () => resposta(200, { ok: true }));
  report = vi.fn<(error: ExplainedError) => void>();
  window.fetch = baseFetch as unknown as typeof fetch;
  resetNavigationMemory();
  // O módulo usa a URL da página para descobrir a aba.
  window.history.replaceState({}, "", "/transacoes");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const f of desinstalar.reverse()) f();
  desinstalar = [];
  vi.restoreAllMocks();
});

/** Instala o invólucro e registra o cleanup. */
function instalarFetch() {
  desinstalar.push(installFetchMonitor({ report }));
}

/** Espera os envios de log (disparados sem await dentro do invólucro). */
async function aguardarLogs() {
  await vi.waitFor(() => expect(baseFetch.mock.calls.some((c) => c[0] === LOG_ENDPOINT)).toBe(true));
}

describe("installFetchMonitor — sucesso", () => {
  it("registra escrita bem-sucedida como movimentação", async () => {
    instalarFetch();

    await window.fetch("/api/transactions", { method: "POST" });
    await aguardarLogs();

    const [ev] = eventosGravados();
    expect(ev.level).toBe("info");
    expect(ev.action).toBe("gravou");
    expect(ev.detail).toContain("criou transação");
    expect(ev.tab).toBe("transacoes");
  });

  it("NÃO registra leitura bem-sucedida", async () => {
    // O dashboard e a tela de investimentos consultam a API a cada 30s;
    // registrar isso soterraria as mudanças de verdade.
    instalarFetch();

    await window.fetch("/api/investments/prices");

    expect(eventosGravados()).toHaveLength(0);
  });

  it("devolve a resposta original para quem chamou", async () => {
    instalarFetch();

    const r = await window.fetch("/api/transactions", { method: "POST" });

    expect(r.status).toBe(200);
  });

  it("registra os quatro métodos de escrita", async () => {
    instalarFetch();

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      await window.fetch("/api/transactions", { method });
    }
    await vi.waitFor(() => expect(eventosGravados()).toHaveLength(4));
  });

  it("aceita a URL como objeto Request, não só string", async () => {
    instalarFetch();

    await window.fetch(new Request("http://localhost/api/categories", { method: "DELETE" }));
    await aguardarLogs();

    expect(eventosGravados()[0].detail).toContain("apagou categoria");
  });

  it("aceita a URL como objeto URL", async () => {
    instalarFetch();

    await window.fetch(new URL("http://localhost/api/categories"), { method: "POST" });
    await aguardarLogs();

    expect(eventosGravados()[0].detail).toContain("criou categoria");
  });
});

describe("installFetchMonitor — a rota de log não é interceptada", () => {
  it("passa direto, sem gerar evento (evita laço infinito)", async () => {
    // Se a rota de log fosse interceptada, uma falha de gravação viraria um
    // evento de log, que falharia, que geraria outro evento...
    instalarFetch();

    await window.fetch(LOG_ENDPOINT, { method: "POST", body: "{}" });

    expect(eventosGravados()).toHaveLength(0);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it("nem quando a própria rota de log falha", async () => {
    instalarFetch();
    baseFetch.mockResolvedValue(resposta(500, { error: "disco cheio" }));

    await window.fetch(LOG_ENDPOINT, { method: "POST" });

    expect(report).not.toHaveBeenCalled();
  });
});

describe("installFetchMonitor — resposta de erro", () => {
  it("registra e abre pop-up explicado", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT
        ? resposta(200, { ok: true })
        : resposta(400, { error: { fieldErrors: { amount: ["esperado number"] } } }),
    );

    await window.fetch("/api/transactions", { method: "POST" });
    await aguardarLogs();

    expect(report).toHaveBeenCalledTimes(1);
    const explicado = report.mock.calls[0][0];
    expect(explicado.title).toBe("Dados recusados pelo servidor");
    expect(explicado.what).toContain("amount");

    const [ev] = eventosGravados();
    expect(ev.level).toBe("error");
    expect(ev.detail).toContain("Dados recusados");
    expect(ev.technical).toContain("HTTP 400");
  });

  it("registra erro também em leitura que falha", async () => {
    // Leitura bem-sucedida não é movimentação, mas leitura que FALHA é erro —
    // e erro nunca fica sem registro.
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT ? resposta(200, { ok: true }) : resposta(500),
    );

    await window.fetch("/api/investments/prices");
    await aguardarLogs();

    expect(eventosGravados()[0].level).toBe("error");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("não consome o corpo que o chamador ainda vai ler", async () => {
    instalarFetch();
    const corpo = { error: "detalhe" };
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT ? resposta(200, { ok: true }) : resposta(400, corpo),
    );

    const r = await window.fetch("/api/transactions", { method: "POST" });

    // O invólucro leu um clone; o original segue disponível.
    expect(await r.clone().text()).toBe(JSON.stringify(corpo));
  });

  it("corpo que não é JSON entra no detalhe como texto", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT ? resposta(200, { ok: true }) : resposta(500, "Internal Server Error"),
    );

    await window.fetch("/api/transactions", { method: "POST" });
    await aguardarLogs();

    expect(eventosGravados()[0].technical).toContain("Internal Server Error");
  });

  it("corpo vazio não impede o registro", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT ? resposta(200, { ok: true }) : resposta(404),
    );

    await window.fetch("/api/transactions/x", { method: "DELETE" });
    await aguardarLogs();

    expect(report.mock.calls[0][0].title).toBe("Registro não encontrado");
  });

  it("rota de prévia é registrada mas NÃO abre pop-up", async () => {
    // A prévia é recalculada a cada tecla e pode recusar um estado
    // intermediário do formulário; pop-up a cada tecla travaria a tela.
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) =>
      url === LOG_ENDPOINT ? resposta(200, { ok: true }) : resposta(400, { error: "datas" }),
    );

    await window.fetch(POPUP_MUTED_PATHS[0], { method: "POST" });
    await aguardarLogs();

    expect(eventosGravados()[0].level).toBe("error");
    expect(report).not.toHaveBeenCalled();
  });
});

describe("installFetchMonitor — exceção de rede", () => {
  it("registra, abre pop-up e repassa a exceção", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) => {
      if (url === LOG_ENDPOINT) return resposta(200, { ok: true });
      throw new TypeError("Failed to fetch");
    });

    await expect(window.fetch("/api/transactions", { method: "POST" })).rejects.toThrow(
      "Failed to fetch",
    );
    await aguardarLogs();

    expect(report.mock.calls[0][0].title).toBe("Sem resposta do servidor");
    expect(eventosGravados()[0].level).toBe("error");
  });

  it("cancelamento deliberado NÃO é erro", async () => {
    // O modal de aluguel aborta a prévia a cada tecla digitada.
    instalarFetch();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    baseFetch.mockImplementation(async (url: string) => {
      if (url === LOG_ENDPOINT) return resposta(200, { ok: true });
      throw abort;
    });

    await expect(window.fetch("/api/seasonal-rentals/preview", { method: "POST" })).rejects.toThrow(
      "aborted",
    );

    expect(report).not.toHaveBeenCalled();
    expect(eventosGravados()).toHaveLength(0);
  });

  it("valor lançado que não é Error também é registrado", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) => {
      if (url === LOG_ENDPOINT) return resposta(200, { ok: true });
      throw "quebrou";
    });

    await expect(window.fetch("/api/transactions", { method: "POST" })).rejects.toBe("quebrou");
    await aguardarLogs();

    expect(eventosGravados()[0].technical).toContain("quebrou");
  });
});

describe("installFetchMonitor — falha do próprio log", () => {
  it("não derruba a ação do usuário quando a rota de log falha", async () => {
    instalarFetch();
    baseFetch.mockImplementation(async (url: string) => {
      if (url === LOG_ENDPOINT) throw new Error("log fora do ar");
      return resposta(201);
    });

    // A escrita do usuário tem que continuar funcionando.
    const r = await window.fetch("/api/transactions", { method: "POST" });

    expect(r.status).toBe(201);
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });
});

describe("installFetchMonitor — desinstalação", () => {
  it("restaura o fetch original", () => {
    const restaurar = installFetchMonitor({ report });
    expect(window.fetch).not.toBe(baseFetch);

    restaurar();

    expect(window.fetch).toBe(baseFetch);
  });
});

describe("installGlobalErrorHandlers", () => {
  it("registra e explica exceção não capturada", async () => {
    desinstalar.push(installGlobalErrorHandlers({ report }));

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("undefined.foo") }));
    await aguardarLogs();

    expect(report.mock.calls[0][0].title).toBe("Erro inesperado na tela");
    expect(eventosGravados()[0].level).toBe("error");
    expect(eventosGravados()[0].detail).toContain("erro de JavaScript");
  });

  it("usa a mensagem do evento quando não há objeto de erro", async () => {
    desinstalar.push(installGlobalErrorHandlers({ report }));

    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    await aguardarLogs();

    expect(report.mock.calls[0][0].why).toContain("Script error.");
  });

  it("registra promessa rejeitada sem tratamento", async () => {
    desinstalar.push(installGlobalErrorHandlers({ report }));

    // jsdom não dispara PromiseRejectionEvent sozinho; o evento é simulado.
    const evento = new Event("unhandledrejection") as Event & { reason?: unknown };
    evento.reason = new Error("sem catch");
    window.dispatchEvent(evento);
    await aguardarLogs();

    expect(eventosGravados()[0].detail).toContain("promessa rejeitada");
  });

  it("remove os handlers na desinstalação", () => {
    // A verificação é pelos próprios add/removeEventListener, e não disparando
    // um evento depois: sem handler nosso, o jsdom trata o ErrorEvent como
    // exceção não capturada e o Vitest falha o arquivo inteiro por causa disso.
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const remover = installGlobalErrorHandlers({ report });
    const instalados = add.mock.calls.filter(
      ([tipo]) => tipo === "error" || tipo === "unhandledrejection",
    );
    expect(instalados).toHaveLength(2);

    remover();

    for (const [tipo, handler] of instalados) {
      expect(remove).toHaveBeenCalledWith(tipo, handler);
    }
  });
});

describe("logNavigation", () => {
  it("registra a entrada na aba, com o rótulo legível", async () => {
    logNavigation("/investimentos");
    await aguardarLogs();

    const [ev] = eventosGravados();
    expect(ev.action).toBe("navegou");
    expect(ev.tab).toBe("investimentos");
    expect(ev.detail).toBe("abriu Investimentos (/investimentos)");
  });

  it("não repete a mesma rota duas vezes seguidas", async () => {
    // Em desenvolvimento o React roda o efeito duas vezes (StrictMode monta →
    // desmonta → monta), o que gerava duas linhas idênticas no arquivo.
    logNavigation("/investimentos");
    logNavigation("/investimentos");
    await aguardarLogs();

    expect(eventosGravados()).toHaveLength(1);
  });

  it("registra de novo ao voltar para uma aba já visitada", async () => {
    logNavigation("/investimentos");
    logNavigation("/transacoes");
    logNavigation("/investimentos");
    await vi.waitFor(() => expect(eventosGravados()).toHaveLength(3));
  });

  it("rota desconhecida também é registrada", async () => {
    logNavigation("/rota-estranha");
    await aguardarLogs();

    expect(eventosGravados()[0].tab).toBe("outras-rotas");
  });
});
