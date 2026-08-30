import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * Testar o layout raiz tem uma peculiaridade: ele renderiza `<html>`, `<head>`
 * e `<body>`, e o React 19 NÃO coloca essas tags dentro do container de teste —
 * ele iça os atributos do `<html>` para o `document.documentElement` e o
 * `<script>` para o `document.head`, exatamente como faria numa página real.
 * Por isso as asserções aqui olham o documento, não o container.
 *
 * `next/font/google` é substituído porque tenta buscar a fonte na internet em
 * tempo de execução — sem o dublê, o simples import do layout falha.
 */
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import RootLayout, { metadata } from "@/app/layout";

/**
 * Renderiza o layout. O React avisa no console sobre `<html>` fora do lugar —
 * é esperado neste cenário de teste, então o aviso é silenciado.
 */
function renderizarLayout(children: React.ReactNode = <p>conteúdo da página</p>) {
  const erro = vi.spyOn(console, "error").mockImplementation(() => {});
  // O tipo do layout do Next exige `params` (mesmo na rota raiz, onde é vazio).
  const resultado = render(<RootLayout params={Promise.resolve({})}>{children}</RootLayout>);
  erro.mockRestore();
  return resultado;
}

/** O script de tema, içado pelo React para o `<head>` do documento. */
function scriptDeTema(): HTMLScriptElement {
  const scripts = Array.from(document.head.querySelectorAll("script"));
  const script = scripts.filter((s) => s.innerHTML.includes("prefers-color-scheme")).at(-1);
  if (!script) throw new Error("script de tema não encontrado no <head>");
  return script;
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("layout raiz — metadados", () => {
  it("define título e descrição do app", () => {
    expect(metadata.title).toBe("Controle Financeiro");
    expect(metadata.description).toBe("Controle financeiro pessoal local");
  });
});

describe("layout raiz — estrutura", () => {
  it("envolve o conteúdo da página", () => {
    renderizarLayout();
    expect(screen.getByText("conteúdo da página")).toBeInTheDocument();
  });

  it("inclui a barra de navegação em todas as páginas", () => {
    renderizarLayout();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("coloca o conteúdo dentro do <main> centralizado", () => {
    const { container } = renderizarLayout();

    const main = container.querySelector("main");
    expect(main).toBeTruthy();
    expect(main!.className).toContain("max-w-6xl");
    expect(main!.textContent).toBe("conteúdo da página");
  });

  it("declara o idioma pt-BR", () => {
    renderizarLayout();
    expect(document.documentElement).toHaveAttribute("lang", "pt-BR");
  });

  it("aplica as variáveis de fonte no html", () => {
    renderizarLayout();

    expect(document.documentElement.className).toContain("--font-geist-sans");
    expect(document.documentElement.className).toContain("--font-geist-mono");
  });

  it("injeta o script que aplica o tema antes do primeiro paint", () => {
    renderizarLayout();

    const script = scriptDeTema();
    expect(script.innerHTML).toContain("localStorage.getItem");
    expect(script.innerHTML).toContain("prefers-color-scheme: dark");
    expect(script.innerHTML).toContain("classList.toggle");
  });
});

/**
 * O script de tema é uma string executada fora do React. Estes testes rodam a
 * string de verdade (via `new Function`) para cobrir os três caminhos: escolha
 * salva, preferência do sistema, e falha de acesso ao localStorage.
 */
describe("layout raiz — script de tema", () => {
  function executarScriptDeTema() {
    renderizarLayout(null);
    new Function(scriptDeTema().innerHTML)();
  }

  it("usa o tema escuro salvo pelo usuário", () => {
    localStorage.setItem("theme", "dark");

    executarScriptDeTema();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("usa o tema claro salvo, mesmo se o sistema preferir escuro", () => {
    localStorage.setItem("theme", "light");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    executarScriptDeTema();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("cai na preferência do sistema quando nada foi salvo", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("dark") }));

    executarScriptDeTema();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("fica no tema claro quando o sistema também prefere claro", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    executarScriptDeTema();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    vi.unstubAllGlobals();
  });

  it("não quebra quando o localStorage está bloqueado", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("acesso negado");
      },
    });

    expect(() => executarScriptDeTema()).not.toThrow();

    if (original) Object.defineProperty(window, "localStorage", original);
  });
});
