/**
 * Setup dos testes que rodam em jsdom (componentes e páginas).
 *
 * Faz três coisas:
 * 1. Registra os matchers do jest-dom (`toBeInTheDocument`, `toHaveValue`...).
 * 2. Desmonta o que foi renderizado depois de cada teste. A limpeza
 *    automática da Testing Library só se registra quando os globals do
 *    Vitest estão ligados; aqui eles estão desligados de propósito (import
 *    explícito é mais legível), então a limpeza é feita à mão.
 * 3. Preenche APIs de navegador que o jsdom não implementa mas que o app usa
 *    (`matchMedia`, `ResizeObserver`), senão qualquer componente com Recharts
 *    ou com detecção de tema quebra na renderização.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom não tem matchMedia. Devolve sempre "não casou" (tema claro), que é o
// padrão que os testes assumem quando não sobrescrevem isso.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// ---------------------------------------------------------------------------
// Layout fingido, para o Recharts conseguir desenhar
// ---------------------------------------------------------------------------
// O jsdom não faz layout: todo elemento mede 0x0. O `ResponsiveContainer` do
// Recharts só renderiza o gráfico depois de saber o tamanho do container, e
// descobre isso por `ResizeObserver` + `getBoundingClientRect`. Sem os dublês
// abaixo, todo gráfico renderiza como um SVG vazio e qualquer teste de gráfico
// passa a testar nada.
const LARGURA = 800;
const ALTURA = 400;

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  /** Entrega o tamanho de imediato — é o que destrava a renderização. */
  observe(target: Element) {
    const contentRect = {
      width: LARGURA,
      height: ALTURA,
      top: 0,
      left: 0,
      right: LARGURA,
      bottom: ALTURA,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
    this.callback(
      [{ target, contentRect } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

for (const [prop, valor] of [
  ["clientWidth", LARGURA],
  ["clientHeight", ALTURA],
  ["offsetWidth", LARGURA],
  ["offsetHeight", ALTURA],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value: valor });
}

HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    width: LARGURA,
    height: ALTURA,
    top: 0,
    left: 0,
    right: LARGURA,
    bottom: ALTURA,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
};
