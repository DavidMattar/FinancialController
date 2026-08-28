import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FREE_TO_SPEND_PERCENT = 0.15;
const TITHE_PERCENT = 0.1;
const INVESTMENT_PERCENT = 0.75;

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/budget/summary
 * Calcula, para o mês corrente (do dia 1 ao último dia do mês — sempre o mês atual,
 * não recebe parâmetro de período porque essa regra é fixa mensal por design), a
 * divisão da renda em três fatias:
 *   - 15% "disponível para gastar": dinheiro livre do mês. Some 15% de toda receita
 *     recebida e subtraia todo gasto marcado com `category.deductsFromFreeSpend = true`.
 *   - 10% "dízimo": apenas informativo, não é subtraído de nada.
 *   - 75% "investimento": apenas informativo, não é subtraído de nada.
 *
 * IMPORTANTE: nada aqui é armazenado como saldo acumulado — os três valores são
 * recalculados do zero a partir das transações do mês a cada chamada. Isso garante
 * que, se uma transação antiga for editada ou uma categoria mudar sua flag de
 * desconto, o valor "disponível para gastar" já reflita a correção automaticamente,
 * sem precisar de nenhuma migração de dados ou recomputação manual.
 */
export async function GET() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const [incomeTransactions, expenseTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { type: "INCOME", date: { gte: monthStart, lte: monthEnd } },
      select: { amount: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "EXPENSE",
        date: { gte: monthStart, lte: monthEnd },
        category: { deductsFromFreeSpend: true },
      },
      select: { amount: true },
    }),
  ]);

  const totalIncome = incomeTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const discountableExpenses = expenseTransactions.reduce((sum, t) => sum + Number(t.amount), 0);

  const freeToSpendAllocated = totalIncome * FREE_TO_SPEND_PERCENT;
  const titheAmount = totalIncome * TITHE_PERCENT;
  const investmentAmount = totalIncome * INVESTMENT_PERCENT;

  return NextResponse.json({
    periodFrom: toISODate(monthStart),
    periodTo: toISODate(monthEnd),
    totalIncome,
    freeToSpend: {
      percent: FREE_TO_SPEND_PERCENT * 100,
      allocated: freeToSpendAllocated,
      spent: discountableExpenses,
      available: freeToSpendAllocated - discountableExpenses,
    },
    tithe: { percent: TITHE_PERCENT * 100, amount: titheAmount },
    investment: { percent: INVESTMENT_PERCENT * 100, amount: investmentAmount },
  });
}
