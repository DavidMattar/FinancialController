"use client";

/**
 * Página inicial ("/") — o Dashboard. Mostra um resumo do período
 * selecionado (cards de total gasto, ticket médio, nº de transações),
 * gráficos de pizza por categoria (gastos e ganhos), evolução dos últimos
 * 6 meses, o painel de "devoluções pendentes" e uma lista das transações
 * mais recentes. O banner dos 15% no topo segue o mesmo período escolhido
 * no DateRangePicker (com vários meses selecionados ele mostra o acumulado —
 * ver FreeToSpendBanner e src/lib/budget.ts).
 */
import { useEffect, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import SavedViewsBar from "@/components/SavedViewsBar";
import SummaryCards from "@/components/SummaryCards";
import CategoryPieChart, { type CategorySlice } from "@/components/CategoryPieChart";
import MonthlyTrendChart, { type MonthlyPoint } from "@/components/MonthlyTrendChart";
import TransactionsTable from "@/components/TransactionsTable";
import PendingReturnsPanel from "@/components/PendingReturnsPanel";
import FreeToSpendBanner from "@/components/FreeToSpendBanner";
import { currentMonthRange, lastNMonthsRange, type DateRange } from "@/lib/dateRanges";
import type { Category, Transaction } from "@/lib/types";

interface Metrics {
  totalExpense: number;
  transactionCount: number;
  averageTicket: number;
  byCategory: CategorySlice[];
  byCategoryIncome: CategorySlice[];
  topMerchants: { description: string; total: number }[];
}

export default function DashboardPage() {
  // `range` é o período escolhido pelo usuário no DateRangePicker (padrão: mês atual).
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // `trend` é sempre fixo nos últimos 6 meses, independente do `range" escolhido —
  // é um gráfico de "visão geral" que não deve mudar quando o usuário filtra o resto da tela.
  const [trend, setTrend] = useState<MonthlyPoint[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Carrega a lista de categorias uma única vez (usada para colorir/nomear
  // os gráficos e a tabela de transações recentes).
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setCategories);
  }, []);

  // Carrega o gráfico de evolução mensal uma única vez, sempre com os
  // últimos 6 meses fixos (não depende do range selecionado pelo usuário).
  useEffect(() => {
    const trendRange = lastNMonthsRange(6);
    fetch(`/api/transactions/metrics?from=${trendRange.from}&to=${trendRange.to}`)
      .then((r) => r.json())
      .then((data) => setTrend(data.byMonth));
  }, []);

  /**
   * Sempre que o período selecionado (`range`) muda, busca em paralelo as
   * métricas agregadas (totais, por categoria) e a lista de transações do
   * período, mostrando só as 8 mais recentes na tabela.
   */
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/transactions/metrics?from=${range.from}&to=${range.to}`).then((r) => r.json()),
      fetch(`/api/transactions?from=${range.from}&to=${range.to}`).then((r) => r.json()),
    ])
      .then(([metricsData, transactions]) => {
        setMetrics(metricsData);
        setRecent(transactions.slice(0, 8));
      })
      .finally(() => setLoading(false));
  }, [range]);

  /** Atualiza localmente (sem recarregar do servidor) o marcador de "devolução pendente" de uma transação na lista de recentes. */
  function handlePendingReturnChange(id: string, value: boolean) {
    setRecent((prev) => prev.map((t) => (t.id === id ? { ...t, pendingReturn: value } : t)));
  }

  return (
    <div className="space-y-6">
      <FreeToSpendBanner range={range} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Dashboard</h1>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      <SavedViewsBar currentRange={range} onApply={setRange} />

      {loading || !metrics ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
      ) : (
        <>
          <SummaryCards
            totalExpense={metrics.totalExpense}
            transactionCount={metrics.transactionCount}
            averageTicket={metrics.averageTicket}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Gastos por categoria</h2>
              <CategoryPieChart data={metrics.byCategory} />
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Ganhos por categoria</h2>
              <CategoryPieChart data={metrics.byCategoryIncome} emptyMessage="Sem ganhos no período selecionado." />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Evolução (últimos 6 meses)</h2>
            <MonthlyTrendChart data={trend} />
          </div>

          <PendingReturnsPanel />

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Maiores gastos (por estabelecimento)</h2>
            <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-700">
              {metrics.topMerchants.map((m) => (
                <li key={m.description} className="flex justify-between py-1.5">
                  <span className="truncate pr-4 text-slate-700 dark:text-slate-300">{m.description}</span>
                  <span className="font-medium whitespace-nowrap text-slate-900 dark:text-slate-100">
                    {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(m.total)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Transações recentes</h2>
            <TransactionsTable
              transactions={recent}
              categories={categories}
              onPendingReturnChange={handlePendingReturnChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
