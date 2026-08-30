import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { useIsDark } from "@/lib/useIsDark";

/**
 * O hook observa a classe `dark` no `<html>` com um MutationObserver, porque o
 * botão de tema mexe na classe fora do ciclo do React — um componente que só
 * lesse o valor no primeiro render nunca saberia da troca de tema.
 *
 * Como não existe `renderHook` sem dependência extra aqui, o hook é exercitado
 * por um componente mínimo que escreve o valor no DOM.
 */
function renderizarHook() {
  const valores: boolean[] = [];
  function Sonda() {
    const isDark = useIsDark();
    valores.push(isDark);
    return createElement("span", { "data-testid": "valor" }, String(isDark));
  }
  const utils = render(createElement(Sonda));
  return {
    ...utils,
    valores,
    atual: () => utils.getByTestId("valor").textContent === "true",
  };
}

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("useIsDark", () => {
  it("devolve false quando o tema claro está ativo", () => {
    const { atual } = renderizarHook();
    expect(atual()).toBe(false);
  });

  it("devolve true quando a classe dark já está no html na montagem", () => {
    document.documentElement.classList.add("dark");
    const { atual } = renderizarHook();
    expect(atual()).toBe(true);
  });

  it("reage quando a classe dark é adicionada depois do render", async () => {
    const { atual } = renderizarHook();
    expect(atual()).toBe(false);

    await act(async () => {
      document.documentElement.classList.add("dark");
      // O MutationObserver entrega as mudanças em microtask.
      await Promise.resolve();
    });

    expect(atual()).toBe(true);
  });

  it("reage quando a classe dark é removida depois do render", async () => {
    document.documentElement.classList.add("dark");
    const { atual } = renderizarHook();
    expect(atual()).toBe(true);

    await act(async () => {
      document.documentElement.classList.remove("dark");
      await Promise.resolve();
    });

    expect(atual()).toBe(false);
  });

  it("ignora mudanças de outros atributos do html", async () => {
    const { valores } = renderizarHook();
    const antes = valores.length;

    await act(async () => {
      document.documentElement.setAttribute("lang", "en");
      await Promise.resolve();
    });

    // Pode haver notificação do observer, mas o valor não muda de false.
    expect(valores.slice(antes).every((v) => v === false)).toBe(true);
  });

  it("desliga o observer ao desmontar (não vaza nem quebra depois)", async () => {
    const { unmount, valores } = renderizarHook();
    unmount();
    const antes = valores.length;

    await act(async () => {
      document.documentElement.classList.add("dark");
      await Promise.resolve();
    });

    // Nenhum render novo depois de desmontado.
    expect(valores.length).toBe(antes);
  });
});
