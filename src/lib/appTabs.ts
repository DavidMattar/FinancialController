/**
 * As abas do app — a lista única de rotas de usuário.
 *
 * Existe porque três lugares precisam concordar sobre "quais são as abas e
 * como cada uma se chama": a barra de navegação (`Nav`), o nome do arquivo de
 * log de cada aba (`logs/AAAA-MM-DD/<slug>.log`) e o texto que aparece dentro
 * do log. Duas listas paralelas divergiriam na primeira aba nova — é o mesmo
 * motivo do `SETTLEMENT_FIELD` dos repasses de aluguel viver num lugar só.
 */

/** Uma aba do app. */
export interface AppTab {
  /** Rota exata da página. */
  href: string;
  /** Nome exibido na barra de navegação. */
  label: string;
  /**
   * Nome do arquivo de log dessa aba. Só letras minúsculas, dígitos e hífen —
   * é usado como nome de arquivo, então nada de acento, espaço ou barra.
   */
  slug: string;
}

export const APP_TABS: AppTab[] = [
  { href: "/", label: "Dashboard", slug: "dashboard" },
  { href: "/transacoes", label: "Transações", slug: "transacoes" },
  { href: "/transacoes-familia", label: "Transações Família", slug: "transacoes-familia" },
  { href: "/receitas", label: "Receitas", slug: "receitas" },
  { href: "/importar-fatura", label: "Importar Fatura", slug: "importar-fatura" },
  { href: "/categorias", label: "Categorias", slug: "categorias" },
  { href: "/investimentos", label: "Investimentos", slug: "investimentos" },
  { href: "/relatorios", label: "Relatórios", slug: "relatorios" },
];

/**
 * Slug usado quando a rota atual não é nenhuma aba conhecida (ex: uma URL
 * digitada à mão, ou uma página nova que ainda não entrou em `APP_TABS`).
 * Existe para uma movimentação nunca ficar sem arquivo de log — o requisito é
 * que NADA fique sem registro, então "não sei de qual aba veio" precisa de um
 * destino, não de um descarte.
 */
export const UNKNOWN_TAB_SLUG = "outras-rotas";

/**
 * As abas ordenadas da rota mais específica para a mais geral, usadas no
 * casamento por prefixo de `tabForPath`.
 *
 * Calculado uma vez, no carregamento do módulo, e não a cada chamada. A ordem
 * importa para o dia em que existirem abas aninhadas (`/relatorios` e
 * `/relatorios/mensal`): sem ela, `/relatorios/mensal/x` poderia cair na aba
 * mais geral e a movimentação iria para o arquivo de log errado.
 *
 * A raiz sai da lista porque como prefixo ela casaria com absolutamente tudo.
 */
const TABS_BY_SPECIFICITY: AppTab[] = [...APP_TABS]
  .filter((t) => t.href !== "/")
  .sort((a, b) => b.href.length - a.href.length);

/**
 * A aba correspondente a um caminho de URL.
 *
 * Tenta a rota exata, depois o prefixo mais específico (uma sub-rota futura
 * como `/transacoes/algo` cai na aba de Transações em vez de virar
 * "outras-rotas") e, por último, a aba de rota desconhecida.
 */
export function tabForPath(pathname: string): AppTab {
  const exata = APP_TABS.find((t) => t.href === pathname);
  if (exata) return exata;

  const prefixo = TABS_BY_SPECIFICITY.find((t) => pathname.startsWith(`${t.href}/`));
  if (prefixo) return prefixo;

  return { href: pathname, label: pathname, slug: UNKNOWN_TAB_SLUG };
}

/** `true` se o slug é um nome de arquivo seguro (usado para validar o que chega na API de log). */
export function isValidTabSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(slug);
}
