"use client";

/**
 * Página "/relatorios" — permite escolher um período e um subconjunto de
 * categorias (checkboxes) e ver totais/gráfico apenas dessas categorias, além
 * de exportar o resultado filtrado como CSV. Útil para análises pontuais que
 * não cabem no dashboard padrão.
 *
 * No fim da página fica também o bloco de backup/restauração do banco inteiro
 * (`BackupPanel`) — separado do relatório porque não tem nada a ver com o
 * período/categorias filtrados acima: é uma ferramenta de manutenção dos dados.
 */
import { useEffect, useMemo, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import CategoryPieChart, { type CategorySlice } from "@/components/CategoryPieChart";
import BackupPanel from "@/components/BackupPanel";
import { currentMonthRange, type DateRange } from "@/lib/dateRanges";
import { formatBRL } from "@/lib/format";
import type { Category } from "@/lib/types";

interface Metrics {
  totalExpense: number;
  transactionCount: number;
  averageTicket: number;
  byCategory: CategorySlice[];
}

export default function RelatoriosPage() {
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [categories, setCategories] = useState<Category[]>([]);
  // Lista de IDs de categoria marcados (inclui o pseudo-id "none" = "Sem categoria").
  // Começa como `null` até as categorias carregarem, momento em que é preenchido
  // com TODAS marcadas por padrão (comportamento inicial = ver tudo).
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  // Ao carregar as categorias, já marca todas (+ "Sem categoria") como selecionadas por padrão.
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((data: Category[]) => {
        setCategories(data);
        setSelectedIds([...data.map((c) => c.id), "none"]);
      });
  }, []);

  const allSelectableIds = useMemo(() => [...categories.map((c) => c.id), "none"], [categories]);
  const allSelected = selectedIds !== null && selectedIds.length === allSelectableIds.length;

  // Sempre que o período ou a seleção de categorias mudar, busca as métricas filtradas de novo.
  useEffect(() => {
    if (selectedIds === null) return;
    const params = new URLSearchParams({ from: range.from, to: range.to, categoryIds: selectedIds.join(",") });
    fetch(`/api/transactions/metrics?${params}`)
      .then((r) => r.json())
      .then(setMetrics);
  }, [range, selectedIds]);

  /** Marca/desmarca uma categoria (ou o pseudo-id "none") no filtro. */
  function toggleCategory(id: string) {
    setSelectedIds((prev) => {
      // Guard de tipo: só dá para clicar num checkbox depois de as categorias
      // carregarem, e é nessa mesma resposta que selectedIds deixa de ser nulo —
      // então o lado direito do ?? não é alcançável pela interface.
      /* v8 ignore next */
      const current = prev ?? [];
      return current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
    });
  }

  /** Marca todas as categorias (e "Sem categoria") de uma vez. */
  function selectAll() {
    setSelectedIds(allSelectableIds);
  }

  /** Desmarca todas as categorias, deixando o relatório vazio até o usuário marcar alguma. */
  function clearAll() {
    setSelectedIds([]);
  }

  // Monta a URL de exportação CSV com os mesmos filtros (período + categorias) aplicados na tela.
  const exportParams = new URLSearchParams({ from: range.from, to: range.to });
  if (selectedIds !== null) exportParams.set("categoryIds", selectedIds.join(","));
  const exportUrl = `/api/transactions/export?${exportParams}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Relatórios</h1>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <a
            href={exportUrl}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Exportar CSV
          </a>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Categorias no relatório ({selectedIds?.length ?? 0} de {allSelectableIds.length})
            </p>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={selectAll}
                disabled={allSelected}
                className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                Selecionar todas
              </button>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <button
                type="button"
                onClick={clearAll}
                disabled={selectedIds?.length === 0}
                className="text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                Limpar seleção
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              // Guard de tipo (mesmo motivo do ?? em toggleCategory): a lista de
              // categorias e selectedIds são preenchidos na mesma resposta.
              /* v8 ignore next */
              const checked = selectedIds?.includes(c.id) ?? false;
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm cursor-pointer select-none transition-colors ${
                    checked
                      ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950"
                      : "border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCategory(c.id)}
                    className="accent-indigo-600"
                  />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
                </label>
              );
            })}
            <label
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-sm cursor-pointer select-none transition-colors ${
                selectedIds?.includes("none")
                  ? "border-indigo-300 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950"
                  : "border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedIds?.includes("none") ?? false}
                onChange={() => toggleCategory("none")}
                className="accent-indigo-600"
              />
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-500" />
              <span className="text-slate-700 dark:text-slate-200">Sem categoria</span>
            </label>
          </div>
        </div>

        {metrics && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">Total no período</p>
                <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                  {formatBRL(metrics.totalExpense)}
                </p>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">Transações</p>
                <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                  {metrics.transactionCount}
                </p>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                <p className="text-sm text-slate-500 dark:text-slate-400">Ticket médio</p>
                <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
                  {formatBRL(metrics.averageTicket)}
                </p>
              </div>
            </div>
            <CategoryPieChart data={metrics.byCategory} />
          </>
        )}
      </div>

      <BackupPanel />
    </div>
  );
}
