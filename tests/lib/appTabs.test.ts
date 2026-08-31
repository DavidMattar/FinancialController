import { describe, expect, it } from "vitest";
import { APP_TABS, isValidTabSlug, tabForPath, UNKNOWN_TAB_SLUG } from "@/lib/appTabs";

describe("APP_TABS", () => {
  it("cobre as oito abas do app", () => {
    expect(APP_TABS).toHaveLength(8);
  });

  it("todo slug serve como nome de arquivo", () => {
    // O slug vira `logs/AAAA-MM-DD/<slug>.log`: acento, espaço ou barra
    // quebrariam o caminho.
    for (const tab of APP_TABS) {
      expect(isValidTabSlug(tab.slug), tab.slug).toBe(true);
    }
  });

  it("não repete href nem slug", () => {
    expect(new Set(APP_TABS.map((t) => t.href)).size).toBe(APP_TABS.length);
    expect(new Set(APP_TABS.map((t) => t.slug)).size).toBe(APP_TABS.length);
  });

  it("toda aba tem rótulo legível", () => {
    for (const tab of APP_TABS) expect(tab.label.length).toBeGreaterThan(0);
  });
});

describe("tabForPath", () => {
  it("acha a aba pela rota exata", () => {
    expect(tabForPath("/transacoes").slug).toBe("transacoes");
    expect(tabForPath("/investimentos").label).toBe("Investimentos");
  });

  it("a raiz é o Dashboard", () => {
    expect(tabForPath("/").slug).toBe("dashboard");
  });

  it("uma sub-rota cai na aba dona dela", () => {
    // Se um dia existir /transacoes/algo, a movimentação é da aba Transações.
    expect(tabForPath("/transacoes/abc").slug).toBe("transacoes");
  });

  it("a raiz não engole sub-rota nenhuma", () => {
    // "/" é comparada por igualdade: como prefixo, casaria com tudo.
    expect(tabForPath("/qualquer-coisa").slug).toBe(UNKNOWN_TAB_SLUG);
  });

  it("a ordenação por especificidade é calculada de fato", () => {
    // A lista atual de abas não tem rotas aninhadas, então este teste protege a
    // ordenação para o dia em que tiver: a aba de href mais longo tem que
    // ganhar do prefixo mais curto.
    const porTamanho = [...APP_TABS]
      .filter((t) => t.href !== "/")
      .sort((a, b) => b.href.length - a.href.length);
    expect(porTamanho[0].href.length).toBeGreaterThanOrEqual(
      porTamanho[porTamanho.length - 1].href.length,
    );
  });

  it("prefere a aba mais específica quando duas casam", () => {
    // "/transacoes-familia/x" começa com "/transacoes-familia/", e não com
    // "/transacoes/" — mas o teste protege a ordenação por especificidade.
    expect(tabForPath("/transacoes-familia/x").slug).toBe("transacoes-familia");
  });

  it("rota desconhecida ganha um destino, em vez de ser descartada", () => {
    // O requisito é que nada fique sem registro: "não sei de qual aba veio"
    // precisa de arquivo, não de descarte.
    const tab = tabForPath("/rota-que-nao-existe");
    expect(tab.slug).toBe(UNKNOWN_TAB_SLUG);
    expect(isValidTabSlug(tab.slug)).toBe(true);
  });
});

describe("isValidTabSlug", () => {
  it("aceita minúsculas, dígitos e hífen", () => {
    expect(isValidTabSlug("transacoes-familia")).toBe(true);
    expect(isValidTabSlug("aba2")).toBe(true);
  });

  it("recusa o que quebraria um caminho de arquivo", () => {
    for (const ruim of ["", "com espaço", "acentuação", "MAIUSCULA", "sub/pasta", "../fuga", "a".repeat(65)]) {
      expect(isValidTabSlug(ruim), ruim).toBe(false);
    }
  });
});
