/**
 * Utilidades para testar route handlers do App Router.
 *
 * Um route handler do Next é só uma função que recebe um `Request` (a API
 * padrão da plataforma) e devolve um `Response`, então os testes chamam a
 * função direto — sem servidor HTTP, sem `fetch`, sem porta aberta. Estes
 * helpers só montam o `Request` e leem o `Response` sem repetir boilerplate.
 */

/** `Request` de GET, com querystring opcional. */
export function getRequest(url: string, query?: Record<string, string>): Request {
  const full = new URL(url, "http://localhost:3000");
  if (query) for (const [k, v] of Object.entries(query)) full.searchParams.set(k, v);
  return new Request(full, { method: "GET" });
}

/** `Request` com corpo JSON (POST, PUT ou PATCH). */
export function jsonRequest(
  method: "POST" | "PUT" | "PATCH",
  url: string,
  body: unknown,
  query?: Record<string, string>,
): Request {
  const full = new URL(url, "http://localhost:3000");
  if (query) for (const [k, v] of Object.entries(query)) full.searchParams.set(k, v);
  return new Request(full, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `Request` com corpo que NÃO é JSON válido — usado para testar as rotas que
 * tratam arquivo corrompido/truncado.
 */
export function rawRequest(method: "POST" | "PUT" | "PATCH", url: string, body: string): Request {
  return new Request(new URL(url, "http://localhost:3000"), {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

/** `Request` de DELETE. */
export function deleteRequest(url: string): Request {
  return new Request(new URL(url, "http://localhost:3000"), { method: "DELETE" });
}

/**
 * Segundo argumento dos handlers de rota dinâmica. No App Router atual
 * `params` é uma Promise, então precisa ser embrulhado assim.
 */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** Lê o corpo JSON de um `Response` junto com o status, que é o que os testes checam. */
export async function readJson(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json() };
}

/** Monta um `Request` de upload multipart (usado pelas rotas de importação). */
export function formDataRequest(
  url: string,
  fields: Record<string, string | { fileName: string; content: Uint8Array | string }>,
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      form.append(key, value);
    } else {
      form.append(key, new Blob([value.content as BlobPart]), value.fileName);
    }
  }
  return new Request(new URL(url, "http://localhost:3000"), { method: "POST", body: form });
}
