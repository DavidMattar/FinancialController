"use client";

/**
 * Página "/receitas" — mostra as receitas do mês atual e como elas se
 * dividem pela regra de orçamento 15/10/75 (15% livre para gastar, 10%
 * dízimo, 75% investimento), além da seção de aluguéis de temporada
 * (`SeasonalRentalsSection`). O período é sempre o mês corrente — esta
 * página não tem seletor de data, ao contrário do dashboard.
 */
import { useEffect, useState } from "react";
import TransactionsTable from "@/components/TransactionsTable";
import SeasonalRentalsSection from "@/components/SeasonalRentalsSection";
import { currentMonthRange } from "@/lib/dateRanges";
import { formatBRL } from "@/lib/format";
import type { Category, Transaction } from "@/lib/types";

/** Espelha o resultado de GET /api/budget/summary — resumo do orçamento do mês corrente. */
interface BudgetSummary {
  periodFrom: string;
  periodTo: string;
  totalIncome: number;
  freeToSpend: { percent: number; allocated: number; spent: number; available: number };
  tithe: { percent: number; amount: number };
  investment: { percent: number; amount: number };
}

export default function ReceitasPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Mês corrente — esta página não permite escolher outro período.
  const range = currentMonthRange();

  /** Busca em paralelo: as receitas do mês, a lista de categorias e o resumo de orçamento (15/10/75). */
  async function load() {
    setLoading(true);
    const [txRes, catRes, summaryRes] = await Promise.all([
      fetch(`/api/transactions?type=INCOME&from=${range.from}&to=${range.to}`),
      fetch("/api/categories"),
      fetch("/api/budget/summary"),
    ]);
    setTransactions(await txRes.json());
    setCategories(await catRes.json());
    setSummary(await summaryRes.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Troca a categoria de uma receita e recarrega tudo (o resumo de orçamento pode mudar se a categoria afetar o cálculo). */
  async function handleCategoryChange(id: string, categoryId: string | null) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    load();
  }

  // Nome do mês/ano por extenso (ex: "agosto de 2026") para o título da página.
  const monthLabel = summary
    ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
        new Date(summary.periodFrom + "T00:00:00"),
      )
    : "";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Receitas {monthLabel && `— ${monthLabel}`}
      </h1>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total de receitas no mês</p>
            <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
              {formatBRL(summary.totalIncome)}
            </p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">15% Disponível para gastar</p>
            <p className="text-2xl font-semibold mt-1 text-emerald-800 dark:text-emerald-300">
              {formatBRL(summary.freeToSpend.available)}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
              de {formatBRL(summary.freeToSpend.allocated)} alocado
            </p>
          </div>
          <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 rounded-xl p-4">
            <p className="text-sm text-indigo-700 dark:text-indigo-400">10% Dízimo</p>
            <p className="text-2xl font-semibold mt-1 text-indigo-800 dark:text-indigo-300">
              {formatBRL(summary.tithe.amount)}
            </p>
          </div>
          <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded-xl p-4">
            <p className="text-sm text-sky-700 dark:text-sky-400">75% Investimento</p>
            <p className="text-2xl font-semibold mt-1 text-sky-800 dark:text-sky-300">
              {formatBRL(summary.investment.amount)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Lançamentos de receita no mês</h2>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : (
          <TransactionsTable
            transactions={transactions}
            categories={categories}
            onCategoryChange={handleCategoryChange}
          />
        )}
      </div>

      <SeasonalRentalsSection />
    </div>
  );
}
