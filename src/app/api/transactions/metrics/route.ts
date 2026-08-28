import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";
import type { Prisma } from "@/generated/prisma/client";

/**
 * GET /api/transactions/metrics
 *
 * Calcula as métricas do dashboard (cards de resumo e gráficos) para um
 * período e conjunto de categorias filtrados via query string:
 * - from / to: intervalo de datas "YYYY-MM-DD". Usamos `parseLocalDate` /
 *   `parseLocalDateEndOfDay` (não `new Date()` direto) para não cair no bug
 *   de fuso horário: `new Date("YYYY-MM-DD")` é interpretado como UTC
 *   meia-noite, que no horário do Brasil (UTC-3) é o dia anterior.
 * - categoryIds: lista de ids separados por vírgula. O valor especial
 *   "none" representa "transações sem categoria". Se o parâmetro vier
 *   presente mas vazio, o filtro deve casar com nada (nenhuma categoria
 *   selecionada = nenhum resultado), por isso o truque de usar um id
 *   inexistente (`__no_category_selected__`) como filtro.
 *
 * Depois de buscar as transações no período, o código percorre todas elas
 * manualmente (em memória, não via SQL) para agregar:
 * - totalExpense / totalIncome: soma de gastos e receitas.
 * - byCategory / byCategoryIncome: total gasto/recebido por categoria
 *   (usado nos gráficos de pizza de gastos e de receitas).
 * - byMonth: total de gastos agrupado por mês (usado no gráfico de
 *   tendência mensal).
 * - topMerchants: os 10 estabelecimentos/descrições com maior gasto total
 *   no período.
 *
 * Retorna um único objeto JSON com todos esses números já calculados,
 * pronto para os componentes do dashboard consumirem diretamente.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const categoryIdsParam = searchParams.get("categoryIds");

  const where: Prisma.TransactionWhereInput = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = parseLocalDate(from);
    if (to) where.date.lte = parseLocalDateEndOfDay(to);
  }
  if (categoryIdsParam !== null) {
    const ids = categoryIdsParam.split(",").filter(Boolean);
    if (ids.length === 0) {
      // Seleção explicitamente vazia: não deve casar com nenhuma transação.
      where.id = "__no_category_selected__";
    } else {
      const wantsUncategorized = ids.includes("none");
      const realIds = ids.filter((id) => id !== "none");
      if (wantsUncategorized && realIds.length > 0) {
        where.OR = [{ categoryId: { in: realIds } }, { categoryId: null }];
      } else if (wantsUncategorized) {
        where.categoryId = null;
      } else {
        where.categoryId = { in: realIds };
      }
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true },
  });

  // Mapas usados para acumular os totais por categoria/mês/estabelecimento
  // enquanto percorremos a lista de transações uma única vez abaixo.
  const byCategory = new Map<string, { name: string; color: string; total: number }>();
  const byCategoryIncome = new Map<string, { name: string; color: string; total: number }>();
  let totalExpense = 0;
  let totalIncome = 0;
  let expenseCount = 0;
  const byMonth = new Map<string, number>();
  const byMerchant = new Map<string, number>();

  for (const t of transactions) {
    const amount = Number(t.amount);
    const catKey = t.category?.id ?? "none";
    const catName = t.category?.name ?? "Sem categoria";
    const catColor = t.category?.color ?? "#94a3b8";

    if (t.type === "EXPENSE") {
      totalExpense += amount;
      expenseCount++;

      const entry = byCategory.get(catKey) ?? { name: catName, color: catColor, total: 0 };
      entry.total += amount;
      byCategory.set(catKey, entry);

      const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}`;
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + amount);

      byMerchant.set(t.description, (byMerchant.get(t.description) ?? 0) + amount);
    } else if (t.type === "INCOME") {
      totalIncome += amount;

      const entry = byCategoryIncome.get(catKey) ?? { name: catName, color: catColor, total: 0 };
      entry.total += amount;
      byCategoryIncome.set(catKey, entry);
    }
  }

  // Ordena os estabelecimentos por total gasto (do maior para o menor) e
  // mantém apenas os 10 primeiros para o card "Maiores gastos".
  const topMerchants = Array.from(byMerchant.entries())
    .map(([description, total]) => ({ description, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return NextResponse.json({
    totalExpense,
    transactionCount: expenseCount,
    averageTicket: expenseCount ? totalExpense / expenseCount : 0,
    byCategory: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
    byMonth: Array.from(byMonth.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    topMerchants,
    totalIncome,
    byCategoryIncome: Array.from(byCategoryIncome.values()).sort((a, b) => b.total - a.total),
  });
}
