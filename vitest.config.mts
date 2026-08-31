/**
 * Configuração do Vitest (testes unitários + cobertura).
 *
 * Duas "projects" porque o código deste app vive em dois ambientes bem
 * diferentes e misturar os dois esconde bugs:
 * - `node`: as libs de `src/lib` e os route handlers de `src/app/api`, que
 *   rodam no servidor (têm Prisma, `Request`/`Response`, sem DOM).
 * - `dom`: os componentes e as páginas, que rodam no navegador (precisam de
 *   `document`, e por isso de jsdom + Testing Library).
 *
 * A cobertura é medida por cima das duas de uma vez (o Vitest soma os
 * relatórios), com limite de 100% — ver `coverage.thresholds`.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Mesmo alias "@/..." do tsconfig, senão nenhum import do app resolve.
  resolve: { alias: { "@": srcDir } },
  test: {
    /**
     * Fuso fixo para TODOS os testes. Metade das regras deste app depende de
     * data local (ver `src/lib/dateOnly.ts`), então sem fixar o fuso as
     * asserções passariam nesta máquina e quebrariam em outra. `America/Sao_Paulo`
     * é o fuso em que o app roda de verdade — é ele que expõe o bug de
     * "YYYY-MM-DD interpretado como UTC volta um dia".
     */
    env: { TZ: "America/Sao_Paulo" },
    /**
     * Hooks na ordem em que foram declarados (o padrão do Vitest é rodar os
     * `afterEach` na ordem inversa). Isso garante que o `cleanup()` do
     * `tests/setup.dom.ts` desmonte os componentes ANTES de o `afterEach` do
     * arquivo de teste remover o dublê de `fetch`: na ordem inversa, um efeito
     * ainda pendente caía no `fetch` real e tentava buscar uma URL relativa.
     */
    sequence: { hooks: "list" },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // Só o código-fonte do app entra na conta.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Prisma Client gerado (não é código nosso, e é recriado por
        // `prisma generate` — está no .gitignore).
        "src/generated/**",
        // Arquivo só de tipos/interfaces: não tem uma linha executável para
        // cobrir, e deixá-lo na conta só produz um 0% enganoso.
        "src/lib/types.ts",
      ],
      // Falha a suíte se qualquer métrica cair abaixo de 100%.
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/{lib,api}/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          // `client` guarda o runtime de navegador que nao e componente
          // (a interceptacao de fetch e os handlers globais de erro): e codigo
          // de lib, mas precisa de `window`, logo roda aqui e nao no projeto node.
          include: ["tests/{components,pages,hooks,client}/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup.dom.ts"],
        },
      },
    ],
  },
});
