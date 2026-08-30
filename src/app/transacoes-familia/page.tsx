"use client";

/**
 * Página "/transacoes-familia" — um livro-caixa totalmente separado para
 * gastos/receitas compartilhados da casa (ex: conta de luz dividida, etc.).
 * Usa o modelo `FamilyTransaction`, que é isolado de propósito do modelo
 * `Transaction` principal: nada aqui entra em relatórios, métricas, gráficos
 * do dashboard ou no cálculo do orçamento 15/10/75 — é uma aba paralela.
 */
import { useEffect, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import ConfirmDialog from "@/components/ConfirmDialog";
import { currentMonthRange, type DateRange } from "@/lib/dateRanges";
import { formatBRL, formatDate } from "@/lib/format";
import type { FamilyTransaction } from "@/lib/types";

export default function TransacoesFamiliaPage() {
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [transactions, setTransactions] = useState<FamilyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Guarda a transação selecionada para exclusão até o usuário confirmar no ConfirmDialog.
  const [toDelete, setToDelete] = useState<FamilyTransaction | null>(null);

  /** Busca as transações da família no período selecionado. */
  async function load() {
    setLoading(true);
    const res = await fetch(`/api/family-transactions?from=${range.from}&to=${range.to}`);
    setTransactions(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  /** Confirma a exclusão pendente (aberta pelo ConfirmDialog) e recarrega a lista. */
  async function handleConfirmDelete() {
    // Guard de tipo: o diálogo só abre com um lançamento selecionado.
    /* v8 ignore next */
    if (!toDelete) return;
    await fetch(`/api/family-transactions/${toDelete.id}`, { method: "DELETE" });
    setToDelete(null);
    load();
  }

  // Totais calculados no período exibido, só para o resumo no rodapé da página
  // (não são persistidos em lugar nenhum — sempre recalculados a partir da lista atual).
  const totalIncome = transactions
    .filter((t) => t.type === "INCOME")
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const totalExpense = transactions
    .filter((t) => t.type === "EXPENSE")
    .reduce((sum, t) => sum + Number(t.amount), 0);
  const net = totalIncome - totalExpense;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Transações Família</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Aba independente para gastos e receitas em comum da casa — não aparece em relatórios, métricas ou no
            orçamento do restante do app.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {showForm ? "Cancelar" : "+ Nova transação"}
        </button>
      </div>

      {showForm && (
        <FamilyTransactionForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
        <DateRangePicker value={range} onChange={setRange} />

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4">Nenhuma transação encontrada.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Descrição</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4 text-right">Valor</th>
                  <th className="py-2 pl-2" />
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50">
                    <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {formatDate(t.date)}
                    </td>
                    <td className="py-2 pr-4 text-slate-900 dark:text-slate-100">{t.description}</td>
                    <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {t.type === "INCOME" ? "Receita" : "Despesa"}
                    </td>
                    <td
                      className={`py-2 pr-4 text-right whitespace-nowrap font-medium ${
                        t.type === "INCOME"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-900 dark:text-slate-100"
                      }`}
                    >
                      {formatBRL(Number(t.amount))}
                    </td>
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => setToDelete(t)}
                        className="text-slate-400 hover:text-red-500 text-xs"
                      >
                        excluir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div
        className={`rounded-xl border p-4 flex items-center justify-between ${
          net >= 0
            ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900"
            : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
        }`}
      >
        <div className="text-xs text-slate-500 dark:text-slate-400">
          <p>Receitas no período: {formatBRL(totalIncome)}</p>
          <p>Gastos no período: {formatBRL(totalExpense)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 dark:text-slate-400">Resultado do período</p>
          <p
            className={`text-2xl font-bold ${
              net >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
            }`}
          >
            {formatBRL(net)}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir transação"
        message={`Excluir "${toDelete?.description}"?`}
        confirmLabel="Excluir"
        onConfirm={handleConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

/** Formulário de criação de uma transação da família (receita ou despesa). */
function FamilyTransactionForm({ onCreated }: { onCreated: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [submitting, setSubmitting] = useState(false);

  /** Envia a nova transação da família para a API; valor com vírgula (formato BR) é convertido para ponto. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/family-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          description,
          amount: Number(amount.replace(",", ".")),
          type,
        }),
      });
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Data</label>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>
      <div className="flex flex-col gap-1 col-span-2">
        <label className="text-xs text-slate-500 dark:text-slate-400">Descrição</label>
        <input
          type="text"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Valor (R$)</label>
        <input
          type="text"
          required
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Tipo</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Receita</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        Salvar
      </button>
    </form>
  );
}
