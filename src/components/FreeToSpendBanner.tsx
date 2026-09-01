"use client";

// Banner de destaque no topo do dashboard mostrando quanto ainda pode ser
// gasto livremente (regra dos 15% da receita) no PERÍODO FILTRADO na tela,
// recalculado sempre a partir dos dados atuais (nunca é um saldo salvo).
//
// A fatia de 15% acumula dentro do período: com vários meses selecionados, o
// número grande é o saldo do período inteiro (estouro de um mês desconta do
// mês seguinte, sobra de um mês soma no próximo) e o detalhamento recolhido
// mostra o caminho mês a mês. A conta em si é do servidor
// (`src/lib/budget.ts`) — aqui é só exibição.

import { useEffect, useState } from "react";
import { formatBRL, monthLabel, periodLabel } from "@/lib/format";
import type { BudgetSummary } from "@/lib/budget";
import type { DateRange } from "@/lib/dateRanges";

interface Props {
  /** Período selecionado no dashboard — o mesmo do `DateRangePicker`. */
  range: DateRange;
}

export default function FreeToSpendBanner({ range }: Props) {
  const [summary, setSummary] = useState<BudgetSummary | null>(null);

  // Rebusca o resumo a cada mudança de período. As dependências são as duas
  // strings (e não o objeto `range`), porque o dashboard cria um objeto novo a
  // cada troca de atalho e um período igual não precisa de nova requisição.
  useEffect(() => {
    fetch(`/api/budget/summary?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then(setSummary);
  }, [range.from, range.to]);

  if (!summary) return null;

  // Se o disponível para gastar ficou negativo, o banner vira vermelho (alerta).
  const negative = summary.freeToSpend.available < 0;
  const variosMeses = summary.months.length > 1;
  // "Receita do mês" quando o período é um mês só; "do período" quando não é.
  const rotuloReceita = variosMeses ? "Receita do período" : "Receita do mês";

  return (
    <div
      className={`rounded-xl border p-4 ${
        negative
          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
          : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Disponível para gastar (15% da receita) — {periodLabel(summary.periodFrom, summary.periodTo)}
          </p>
          <p
            className={`text-3xl font-bold ${
              negative ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {formatBRL(summary.freeToSpend.available)}
          </p>
          {variosMeses && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Acumulado dos {summary.months.length} meses do período.
            </p>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 sm:text-right">
          <p>
            {rotuloReceita}: {formatBRL(summary.totalIncome)}
          </p>
          <p>
            15% alocado ({formatBRL(summary.freeToSpend.allocated)}) − gasto descontável (
            {formatBRL(summary.freeToSpend.spent)})
          </p>
        </div>
      </div>

      {/* O detalhamento só existe com mais de um mês: num mês só ele repetiria
          exatamente os números de cima. Vem recolhido (<details>) para o banner
          não crescer 12 linhas quando o filtro é "Este ano". */}
      {variosMeses && (
        <details className="mt-3 border-t border-slate-200/70 dark:border-slate-700/70 pt-2">
          <summary className="text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
            Acúmulo mês a mês ({summary.months.length} meses)
          </summary>
          <ul className="mt-2 text-xs divide-y divide-slate-200/70 dark:divide-slate-700/70">
            {summary.months.map((m) => (
              <li key={m.month} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
                <span className="text-slate-700 dark:text-slate-300">{monthLabel(m.month)}</span>
                <span className="text-slate-500 dark:text-slate-400">
                  15% de {formatBRL(m.income)} = {formatBRL(m.allocated)} − gasto {formatBRL(m.spent)}
                </span>
                <span
                  className={`font-medium whitespace-nowrap ${
                    m.cumulativeAvailable < 0
                      ? "text-red-700 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  acumulado: {formatBRL(m.cumulativeAvailable)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
