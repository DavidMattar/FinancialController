import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";
import { buildBudgetSummary } from "@/lib/budget";

/** Aceita só data pura "YYYY-MM-DD" — o mesmo formato que o `<input type="date">` produz. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/budget/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Calcula a divisão da renda do período em três fatias:
 *   - 15% "disponível para gastar": dinheiro livre. Some 15% de toda receita
 *     recebida e subtraia todo gasto marcado com `category.deductsFromFreeSpend = true`.
 *   - 10% "dízimo": apenas informativo, não é subtraído de nada.
 *   - 75% "investimento": apenas informativo, não é subtraído de nada.
 *
 * O PERÍODO É PARAMETRIZADO (antes era fixo no mês corrente): `/receitas` pede
 * o mês que o usuário escolheu nos seletores do título e o dashboard pede o
 * mesmo período do `DateRangePicker`, para o banner dos 15% falar do que está
 * filtrado na tela. Sem `from`/`to` a resposta continua sendo a do mês corrente
 * — é o padrão de quem chamar a rota sem parâmetro.
 *
 * Quando o período abrange vários meses, a fatia de 15% ACUMULA: o campo
 * `months` traz mês a mês o alocado, o gasto e o saldo acumulado até ali (ver
 * `src/lib/budget.ts`, que é quem faz a conta).
 *
 * `from`/`to` passam por `parseLocalDate`/`parseLocalDateEndOfDay` — nunca
 * `new Date(str)` direto, que interpretaria a data como UTC e voltaria um dia
 * no horário de Brasília. Formato inválido devolve 400 em vez de cair no mês
 * corrente silenciosamente: um período errado na tela é pior do que um erro
 * visível (o pop-up de erro mostra a mensagem).
 *
 * IMPORTANTE: nada aqui é armazenado como saldo acumulado — os valores são
 * recalculados do zero a partir das transações do período a cada chamada. Isso
 * garante que, se uma transação antiga for editada ou uma categoria mudar sua
 * flag de desconto, o "disponível para gastar" já reflita a correção
 * automaticamente, sem migração de dados nem recomputação manual.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  for (const [nome, valor] of [
    ["from", fromParam],
    ["to", toParam],
  ] as const) {
    if (valor !== null && !ISO_DATE.test(valor)) {
      return NextResponse.json(
        { error: `Parâmetro "${nome}" inválido: use o formato YYYY-MM-DD.` },
        { status: 400 },
      );
    }
  }

  // Sem parâmetro, o período é o mês corrente inteiro (dia 1 ao último dia).
  const now = new Date();
  const from = fromParam ? parseLocalDate(fromParam) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = toParam
    ? parseLocalDateEndOfDay(toParam)
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [incomeTransactions, expenseTransactions] = await Promise.all([
    prisma.transaction.findMany({
      where: { type: "INCOME", date: { gte: from, lte: to } },
      // A data entra na seleção porque o detalhamento por mês precisa saber em
      // qual mês do período cada valor caiu.
      select: { amount: true, date: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "EXPENSE",
        date: { gte: from, lte: to },
        category: { deductsFromFreeSpend: true },
      },
      select: { amount: true, date: true },
    }),
  ]);

  return NextResponse.json(buildBudgetSummary(from, to, incomeTransactions, expenseTransactions));
}
