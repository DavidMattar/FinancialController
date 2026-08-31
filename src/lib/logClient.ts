/**
 * Interceptação de TODA movimentação e TODO erro no navegador, e envio para a
 * rota que grava os arquivos de log.
 *
 * Por que interceptar o `fetch` global em vez de chamar um `log()` em cada
 * lugar: o app tem mais de 50 chamadas de API espalhadas em páginas,
 * componentes e modais. Instrumentar uma por uma deixaria de fora as que eu
 * esquecesse hoje e todas as que forem escritas amanhã — e o requisito é que
 * **nada** fique sem registro. Trocando o `fetch` por um invólucro num lugar
 * só, qualquer chamada nova já nasce registrada.
 *
 * Três laços/ruídos que precisam ser evitados, e a razão de cada regra:
 *
 * 1. **A própria rota de log não é interceptada.** Se ela fosse, uma falha de
 *    gravação viraria um evento de log, que tentaria gravar, que falharia de
 *    novo — laço infinito. Falha de log vai só para o `console.error`.
 * 2. **Requisição cancelada não é erro.** O modal de aluguel cancela a prévia
 *    a cada tecla digitada (`AbortController`); tratar isso como falha
 *    encheria a tela de pop-ups enquanto o usuário digita.
 * 3. **As rotas de prévia não abrem pop-up** (mas são registradas). Elas são
 *    recalculadas a cada tecla e podem legitimamente recusar um estado
 *    intermediário do formulário — o modal já mostra esse aviso embutido.
 */
import { explainFailedRequest, explainThrownError, type ExplainedError } from "./errorExplain";
import { describeRequest, isWriteMethod, pathOf, type LogEvent, type LogLevel } from "./logEvents";
import { tabForPath } from "./appTabs";

/** Rota que grava os logs — nunca interceptada (ver nota 1 no topo). */
export const LOG_ENDPOINT = "/api/logs";

/**
 * Rotas registradas no log, mas que NÃO abrem pop-up (ver nota 3 no topo).
 * São as prévias recalculadas enquanto o usuário digita.
 */
export const POPUP_MUTED_PATHS = [
  "/api/seasonal-rentals/preview",
  "/api/rental-settlements/preview",
];

/** Slug da aba atual, deduzido da URL da página. */
function currentTab(): string {
  /* v8 ignore next */
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  return tabForPath(pathname).slug;
}

/**
 * Manda um evento para a rota de log.
 *
 * Usa o `fetch` recebido (o ORIGINAL, guardado antes da troca) para não passar
 * pelo próprio invólucro. Nunca lança: um problema no log não pode derrubar a
 * ação que o usuário estava fazendo.
 */
async function send(rawFetch: typeof fetch, event: LogEvent): Promise<void> {
  try {
    const res = await rawFetch(LOG_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [event] }),
    });
    /* v8 ignore next 3 */
    if (!res.ok) {
      console.error(`[log] a rota de log respondeu ${res.status}; este evento não foi gravado`, event);
    }
  } catch (error) {
    console.error("[log] não foi possível gravar o evento", event, error);
  }
}

/** Monta o evento e envia. */
function record(
  rawFetch: typeof fetch,
  level: LogLevel,
  action: string,
  detail: string,
  technical?: string,
): void {
  void send(rawFetch, {
    at: new Date().toISOString(),
    tab: currentTab(),
    level,
    action,
    detail,
    technical,
  });
}

/** URL de qualquer uma das formas que o `fetch` aceita como primeiro argumento. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Método da requisição, considerando que ele pode vir no `init` ou no `Request`. */
function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

/** `true` quando a exceção é um cancelamento deliberado (ver nota 2 no topo). */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Lê o corpo de uma resposta que falhou SEM consumir o corpo que o chamador
 * ainda vai ler — daí o `clone()`. Devolve o JSON quando dá, o texto cru quando
 * não é JSON, e `undefined` quando não dá para ler nada.
 */
async function readFailureBody(response: Response): Promise<unknown> {
  try {
    const texto = await response.clone().text();
    if (texto === "") return undefined;
    try {
      return JSON.parse(texto);
    } catch {
      return texto;
    }
  } catch {
    /* v8 ignore next 2 */
    return undefined;
  }
}

/** O que o interceptador precisa saber sobre a tela. */
export interface MonitorHooks {
  /** Abre o pop-up de erro. */
  report: (error: ExplainedError) => void;
}

/**
 * Troca `window.fetch` por um invólucro que registra e explica tudo.
 *
 * @returns Função que restaura o `fetch` original (usada no cleanup do efeito
 *   do React, e pelos testes).
 */
export function installFetchMonitor({ report }: MonitorHooks): () => void {
  const rawFetch = window.fetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input);
    const path = pathOf(url);
    // Nota 1: a rota de log passa direto, sem registro e sem pop-up.
    if (path === LOG_ENDPOINT) return rawFetch(input, init);

    const method = methodOf(input, init);
    const descricao = describeRequest(method, url);

    try {
      const response = await rawFetch(input, init);

      if (!response.ok) {
        const body = await readFailureBody(response);
        const explicado = explainFailedRequest({ method, url, status: response.status, body });
        record(rawFetch, "error", "erro", `${descricao} — ${explicado.title}`, explicado.technical);
        // Nota 3: prévia é registrada, mas não abre pop-up.
        if (!POPUP_MUTED_PATHS.includes(path)) report(explicado);
        return response;
      }

      // Leitura bem-sucedida não é "movimentação": o dashboard e a tela de
      // investimentos consultam a API a cada 30s, e registrar isso soterraria
      // as mudanças de verdade no meio de milhares de linhas de consulta.
      if (isWriteMethod(method)) {
        record(rawFetch, "info", "gravou", `${descricao} (HTTP ${response.status})`);
      }
      return response;
    } catch (error) {
      // Nota 2: cancelamento deliberado não é falha.
      if (isAbort(error)) throw error;
      const mensagem = error instanceof Error ? error.message : String(error);
      const explicado = explainFailedRequest({ method, url, networkMessage: mensagem });
      record(rawFetch, "error", "erro", `${descricao} — ${explicado.title}`, explicado.technical);
      report(explicado);
      throw error;
    }
  };

  return () => {
    window.fetch = rawFetch;
  };
}

/**
 * Instala os handlers globais de erro de JavaScript: exceção não capturada e
 * promessa rejeitada sem `catch`.
 *
 * São a rede de segurança do "nada fica sem registro": pegam o que não passou
 * por `fetch` nenhum — um bug de renderização, um `undefined.foo` num handler
 * de clique.
 *
 * @returns Função que remove os handlers.
 */
export function installGlobalErrorHandlers({ report }: MonitorHooks): () => void {
  const rawFetch = window.fetch;

  function relatar(error: unknown, origem: string) {
    const explicado = explainThrownError(error, origem);
    record(rawFetch, "error", "erro", `${explicado.title} — ${origem}`, explicado.technical);
    report(explicado);
  }

  const onError = (event: ErrorEvent) => relatar(event.error ?? event.message, "erro de JavaScript");
  const onRejection = (event: PromiseRejectionEvent) =>
    relatar(event.reason, "promessa rejeitada sem tratamento");

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

/**
 * Última rota já registrada como navegação.
 *
 * Vive no módulo, e não num `useRef`, de propósito: em desenvolvimento o React
 * roda os efeitos duas vezes (StrictMode monta → desmonta → monta), o que
 * desmontava o ref e produzia DUAS linhas "abriu Relatórios" a 7ms de
 * distância no arquivo de log. Uma variável de módulo sobrevive a essa
 * remontagem e a linha sai uma vez só.
 *
 * Não impede registrar a mesma aba de novo depois de sair dela: A → B → A gera
 * três linhas, porque a comparação é só com a ÚLTIMA rota.
 */
let ultimaNavegacao: string | null = null;

/** Zera a memória de navegação — só para os testes começarem limpos. */
export function resetNavigationMemory(): void {
  ultimaNavegacao = null;
}

/** Registra a entrada numa aba (a movimentação "navegou"). */
export function logNavigation(pathname: string): void {
  if (pathname === ultimaNavegacao) return;
  ultimaNavegacao = pathname;
  const tab = tabForPath(pathname);
  void send(window.fetch, {
    at: new Date().toISOString(),
    tab: tab.slug,
    level: "info",
    action: "navegou",
    detail: `abriu ${tab.label} (${pathname})`,
  });
}
