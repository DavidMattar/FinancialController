/**
 * Mock compartilhado do `src/lib/prisma`.
 *
 * Por que um proxy em vez de um objeto escrito à mão: o schema tem 12 models e
 * cada rota usa um punhado de métodos diferentes (`findMany`, `create`,
 * `updateMany`, `deleteMany`, `count`, `aggregate`, `groupBy`...). Declarar
 * tudo à mão daria centenas de linhas que precisariam ser atualizadas a cada
 * método novo usado. O proxy cria um `vi.fn()` na primeira vez que cada
 * `prisma.<model>.<metodo>` é acessado e guarda sempre a MESMA função depois
 * disso — que é o que permite ao teste fazer
 * `prisma.category.findMany.mockResolvedValue(...)` e a rota receber esse
 * valor.
 *
 * Use assim no arquivo de teste (o `vi.mock` é içado para o topo do módulo,
 * então precisa ser a fábrica, não um import comum):
 *
 * ```ts
 * vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));
 * import { prisma, resetPrismaMock } from "../helpers/prismaMock";
 * beforeEach(resetPrismaMock);
 * ```
 */
import { vi, type Mock } from "vitest";

/** Todas as funções já criadas pelo proxy, indexadas por "model.metodo". */
const calls = new Map<string, Mock>();

function fnFor(path: string): Mock {
  let fn = calls.get(path);
  if (!fn) {
    fn = vi.fn();
    calls.set(path, fn);
  }
  return fn;
}

function modelProxy(model: string) {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        return fnFor(`${model}.${prop}`);
      },
      // Faz `"findMany" in prisma.category` e o spread funcionarem.
      has() {
        return true;
      },
    },
  );
}

/** Cache dos proxies de model, para `prisma.category` ser sempre o mesmo objeto. */
const models = new Map<string, object>();

/**
 * Implementação padrão de `$transaction`, que é o que as rotas de backup e de
 * repasse usam. Cobre as duas formas da API do Prisma:
 * - callback (`$transaction(async (tx) => ...)`): chama o callback passando o
 *   próprio mock como cliente de transação, então tudo o que o teste
 *   configurou continua valendo lá dentro;
 * - array (`$transaction([p1, p2])`): resolve as promessas.
 *
 * Um teste que precise simular rollback só precisa sobrescrever:
 * `prisma.$transaction.mockRejectedValue(new Error("..."))`.
 */
async function defaultTransaction(arg: unknown) {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)(prisma);
  }
  return Promise.all(arg as Promise<unknown>[]);
}

export const prisma: any = new Proxy(
  {},
  {
    get(_target, prop: string) {
      // Métodos de nível raiz do client (começam com $).
      if (prop.startsWith("$")) {
        const fn = fnFor(prop);
        if (prop === "$transaction" && fn.getMockImplementation() === undefined) {
          fn.mockImplementation(defaultTransaction);
        }
        return fn;
      }
      let model = models.get(prop);
      if (!model) {
        model = modelProxy(prop);
        models.set(prop, model);
      }
      return model;
    },
    has() {
      return true;
    },
  },
);

/**
 * Limpa implementações e histórico de chamadas de todos os mocks criados.
 * Chame em `beforeEach` para um teste não herdar o `mockResolvedValue` do
 * anterior (fonte clássica de teste que passa sozinho e falha na suíte).
 */
export function resetPrismaMock(): void {
  for (const fn of calls.values()) fn.mockReset();
  // `$transaction` volta a ter a implementação padrão (o mockReset acima a
  // apagaria, e quase todo teste depende dela).
  const tx = calls.get("$transaction");
  if (tx) tx.mockImplementation(defaultTransaction);
}
