import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These pages intentionally fetch-on-mount / fetch-on-filter-change,
      // a one-shot load with no cascading re-render loop.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Regras relaxadas SÓ nos testes (ver tests/): um dublê de componente
    // recebe um saco de props que ele só repassa, e o mock do Prisma é um
    // proxy que cria funções sob demanda — tipar isso em detalhe não acrescenta
    // segurança nenhuma e só deixaria o teste mais difícil de ler. O código de
    // produção (src/) continua sob a regra normal.
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Relatorio HTML de cobertura (gerado, nao e codigo do projeto).
    "coverage/**",
  ]),
]);

export default eslintConfig;
