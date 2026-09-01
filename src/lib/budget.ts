/**
 * Matemática da regra de orçamento 15/10/75 — o único lugar que transforma
 * transações de um período na divisão da renda e no acúmulo mês a mês da
 * fatia de 15%.
 *
 * Por que existe como lib pura: a mesma conta serve dois consumidores com
 * períodos diferentes (o card de um mês só em `/receitas` e o banner do
 * dashboard, que segue o período filtrado, podendo abranger vários meses).
 * Deixando a conta aqui, a rota `/api/budget/summary` só junta banco +
 * cálculo, e o acúmulo pode ser testado sozinho.
 *
 * A fatia de 15% ACUMULA dentro do período: estourar num mês não zera o mês
 * seguinte, e sobrar num mês aumenta o disponível do próximo. Ex: com receita
 * de R$ 100/mês (15% = R$ 15), gastar R$ 32 no primeiro mês deixa o acumulado
 * em −R$ 2 no fim do segundo mês (R$ 30 alocados − R$ 32 gastos) e em
 * +R$ 13 no fim do terceiro, se nada for gasto nele. É por isso que o total
 * do período é simplesmente 15% da receita do período menos o gasto
 * descontável do período — o detalhamento por mês existe para mostrar o
 * caminho, não para mudar o resultado.
 *
 * Nada aqui é armazenado: os valores são recalculados do zero a cada leitura,
 * então editar/excluir uma transação antiga ou virar a flag
 * `Category.deductsFromFreeSpend` corrige o passado automaticamente (seção 6
 * do contexto.md).
 */

import { formatLocalDate } from "./dateOnly";

/** Fatia livre para gastar: 15% da receita do período. */
export const FREE_TO_SPEND_PERCENT = 0.15;
/** Fatia do dízimo: 10% da receita — informativa, não é abatida de nada. */
export const TITHE_PERCENT = 0.1;
/** Fatia de investimento: 75% da receita — informativa, não é abatida de nada. */
export const INVESTMENT_PERCENT = 0.75;

/**
 * Uma transação como ela sai do banco, com só o que esta conta usa.
 *
 * `amount` é `unknown` de propósito (mesma convenção do `PurchaseRecord` de
 * `investments.ts`): o Prisma entrega `Decimal`, o `JSON.stringify` entrega
 * string e um teste entrega number — todos passam por `Number()` aqui dentro.
 */
export interface BudgetEntry {
  amount: unknown;
  date: Date;
}

/** Uma linha do detalhamento mês a mês da fatia de 15%. */
export interface BudgetMonth {
  /** Mês de referência no formato "YYYY-MM" (use `monthLabel` de `format.ts` para exibir). */
  month: string;
  /** Receita recebida neste mês. */
  income: number;
  /** 15% da receita deste mês. */
  allocated: number;
  /** Gasto do mês em categorias com `deductsFromFreeSpend`. */
  spent: number;
  /** `allocated - spent` deste mês isolado (negativo = estourou o mês). */
  monthAvailable: number;
  /** Soma dos `monthAvailable` deste mês e de todos os anteriores do período. */
  cumulativeAvailable: number;
}

/** Resposta de GET /api/budget/summary. */
export interface BudgetSummary {
  periodFrom: string;
  periodTo: string;
  totalIncome: number;
  freeToSpend: { percent: number; allocated: number; spent: number; available: number };
  tithe: { percent: number; amount: number };
  investment: { percent: number; amount: number };
  /** Um item por mês do período, em ordem cronológica (mês sem transação entra zerado). */
  months: BudgetMonth[];
}

/**
 * Mês de referência ("YYYY-MM") de uma data, pelo calendário LOCAL.
 *
 * Precisa ser local, e não UTC: uma transação de 31/08 à noite tem o instante
 * salvo em UTC já no dia 1º de setembro, e cairia no mês errado do
 * detalhamento (mesma armadilha de fuso do `dateOnly.ts`).
 */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Lista os meses de referência ("YYYY-MM") tocados pelo intervalo, em ordem
 * cronológica e sem furos — inclusive os meses em que não houve nenhuma
 * transação, que precisam aparecer zerados para o acúmulo mostrar o mês em
 * que a receita entrou sem gasto nenhum.
 *
 * Um intervalo dentro de um único mês devolve esse mês só; `to` anterior a
 * `from` devolve lista vazia (período impossível, nada a acumular).
 */
export function enumerateMonths(from: Date, to: Date): string[] {
  const meses: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const fim = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= fim) {
    meses.push(monthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return meses;
}

/** Soma os valores das transações agrupando por mês de referência local. */
function sumByMonth(entries: BudgetEntry[]): Map<string, number> {
  const soma = new Map<string, number>();
  for (const entry of entries) {
    const chave = monthKey(entry.date);
    soma.set(chave, (soma.get(chave) ?? 0) + Number(entry.amount));
  }
  return soma;
}

/**
 * Monta o resumo de orçamento do período: as três fatias (15/10/75) e o
 * detalhamento mês a mês com o acúmulo da fatia livre.
 *
 * Os totais são derivados da soma dos meses (e não recontados a partir das
 * listas) justamente para o último `cumulativeAvailable` fechar sempre com
 * `freeToSpend.available` — as duas visões da tela não podem divergir.
 *
 * @param from - Primeiro dia do período (à meia-noite local).
 * @param to - Último dia do período.
 * @param incomes - Transações `INCOME` do período.
 * @param expenses - Transações `EXPENSE` do período em categorias com `deductsFromFreeSpend`.
 */
export function buildBudgetSummary(
  from: Date,
  to: Date,
  incomes: BudgetEntry[],
  expenses: BudgetEntry[],
): BudgetSummary {
  const receitaPorMes = sumByMonth(incomes);
  const gastoPorMes = sumByMonth(expenses);

  let acumulado = 0;
  const months: BudgetMonth[] = enumerateMonths(from, to).map((month) => {
    const income = receitaPorMes.get(month) ?? 0;
    const allocated = income * FREE_TO_SPEND_PERCENT;
    const spent = gastoPorMes.get(month) ?? 0;
    const monthAvailable = allocated - spent;
    acumulado += monthAvailable;
    return { month, income, allocated, spent, monthAvailable, cumulativeAvailable: acumulado };
  });

  const totalIncome = months.reduce((soma, m) => soma + m.income, 0);
  const freeToSpendAllocated = months.reduce((soma, m) => soma + m.allocated, 0);
  const discountableExpenses = months.reduce((soma, m) => soma + m.spent, 0);

  return {
    periodFrom: formatLocalDate(from),
    periodTo: formatLocalDate(to),
    totalIncome,
    freeToSpend: {
      percent: FREE_TO_SPEND_PERCENT * 100,
      allocated: freeToSpendAllocated,
      spent: discountableExpenses,
      available: freeToSpendAllocated - discountableExpenses,
    },
    tithe: { percent: TITHE_PERCENT * 100, amount: totalIncome * TITHE_PERCENT },
    investment: { percent: INVESTMENT_PERCENT * 100, amount: totalIncome * INVESTMENT_PERCENT },
    months,
  };
}
