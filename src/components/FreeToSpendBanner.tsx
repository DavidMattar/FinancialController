"use client";

// Banner de destaque no topo do dashboard mostrando quanto ainda pode ser
// gasto livremente no mês (regra dos 15% da receita), recalculado sempre a
// partir dos dados atuais (nunca é um saldo salvo/acumulado).

import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";

/** Formato retornado por GET /api/budget/summary — ver regra 15/10/75 nesse endpoint. */
interface BudgetSummary {
  periodFrom: string;
  periodTo: string;
  totalIncome: number;
  freeToSpend: { percent: number; allocated: number; spent: number; available: number };
  tithe: { percent: number; amount: number };
  investment: { percent: number; amount: number };
}

export default function FreeToSpendBanner() {
  const [summary, setSummary] = useState<BudgetSummary | null>(null);

  // Busca o resumo do orçamento do mês corrente uma vez, ao montar o componente.
  // O endpoint sempre calcula para o mês atual — não recebe parâmetro de período.
  useEffect(() => {
    fetch("/api/budget/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  if (!summary) return null;

  // Se o disponível para gastar ficou negativo, o banner vira vermelho (alerta).
  const negative = summary.freeToSpend.available < 0;
  // "T00:00:00" evita que o Date seja interpretado em UTC e "volte" um dia
  // (mesmo problema de timezone resolvido em src/lib/dateOnly.ts).
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(
    new Date(summary.periodFrom + "T00:00:00"),
  );

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
        negative
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
      }`}
    >
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Disponível para gastar (15% da receita) — {monthLabel}
        </p>
        <p
          className={`text-3xl font-bold ${
            negative ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {formatBRL(summary.freeToSpend.available)}
        </p>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 sm:text-right">
        <p>Receita do mês: {formatBRL(summary.totalIncome)}</p>
        <p>
          15% alocado ({formatBRL(summary.freeToSpend.allocated)}) − gasto descontável (
          {formatBRL(summary.freeToSpend.spent)})
        </p>
      </div>
    </div>
  );
}
