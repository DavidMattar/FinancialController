"use client";

/**
 * Página "/transacoes" — lista completa de transações (despesas, receitas e
 * pagamentos de fatura) com filtros por período, categoria, tipo e busca por
 * texto. Também permite criar uma transação manualmente através do
 * formulário `ManualTransactionForm`, definido mais abaixo neste arquivo.
 */
import { useEffect, useState } from "react";
import DateRangePicker from "@/components/DateRangePicker";
import TransactionsTable from "@/components/TransactionsTable";
import { currentMonthRange, type DateRange } from "@/lib/dateRanges";
import type { Category, Transaction } from "@/lib/types";

export default function TransacoesPage() {
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Carrega as categorias uma única vez, para popular o filtro e o formulário.
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setCategories);
  }, []);

  /** Busca as transações no servidor aplicando todos os filtros ativos (período, categoria, tipo, texto). */
  async function load() {
    setLoading(true);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (categoryId) params.set("categoryId", categoryId);
    if (type) params.set("type", type);
    if (query) params.set("q", query);
    const res = await fetch(`/api/transactions?${params}`);
    setTransactions(await res.json());
    setLoading(false);
  }

  // Sempre que qualquer filtro mudar, recarrega a lista do servidor.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, categoryId, type, query]);

  /** Troca a categoria de uma transação (usado pelo select de categoria dentro da tabela) e recarrega a lista. */
  async function handleCategoryChange(id: string, newCategoryId: string | null) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: newCategoryId }),
    });
    load();
  }

  /** Exclui uma transação, pedindo confirmação nativa do navegador antes. */
  async function handleDelete(id: string) {
    if (!window.confirm("Excluir esta transação?")) return;
    await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    load();
  }

  /** Atualiza localmente (sem ida ao servidor) o marcador de "devolução pendente" já persistido por outro componente. */
  function handlePendingReturnChange(id: string, value: boolean) {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, pendingReturn: value } : t)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Transações</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {showForm ? "Cancelar" : "+ Nova transação"}
        </button>
      </div>

      {showForm && (
        <ManualTransactionForm
          categories={categories}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <DateRangePicker value={range} onChange={setRange} />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          >
            <option value="">Todas as categorias</option>
            <option value="none">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          >
            <option value="">Todos os tipos</option>
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Crédito</option>
            <option value="PAYMENT">Pagamento</option>
          </select>
          <input
            type="text"
            placeholder="Buscar descrição..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm flex-1 min-w-[160px]"
          />
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : (
          <TransactionsTable
            transactions={transactions}
            categories={categories}
            onCategoryChange={handleCategoryChange}
            onDelete={handleDelete}
            onPendingReturnChange={handlePendingReturnChange}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Formulário de criação manual de transação, usado dentro de "/transacoes"
 * quando o usuário clica em "+ Nova transação". Ao escolher uma categoria de
 * receita, o tipo é travado automaticamente em "Crédito" (ver `handleCategoryPick`),
 * pois não faz sentido lançar uma despesa numa categoria de receita.
 */
function ManualTransactionForm({
  categories,
  onCreated,
}: {
  categories: Category[];
  onCreated: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState<"EXPENSE" | "INCOME" | "PAYMENT">("EXPENSE");
  const [submitting, setSubmitting] = useState(false);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // Se a categoria escolhida for do tipo receita, o campo "Tipo" fica travado/desabilitado.
  const incomeLocked = selectedCategory?.kind === "INCOME";

  /** Ao escolher uma categoria, força o tipo para "Crédito" se a categoria for de receita. */
  function handleCategoryPick(id: string) {
    setCategoryId(id);
    const category = categories.find((c) => c.id === id);
    if (category?.kind === "INCOME") setType("INCOME");
  }

  /** Envia a nova transação para a API; o valor digitado com vírgula (formato BR) é convertido para ponto antes de virar número. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          description,
          amount: Number(amount.replace(",", ".")),
          type,
          categoryId: categoryId || null,
        }),
      });
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
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
          disabled={incomeLocked}
          title={incomeLocked ? "Fixado como Receita por conta da categoria selecionada" : undefined}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm disabled:opacity-60"
        >
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Crédito</option>
          <option value="PAYMENT">Pagamento</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-500 dark:text-slate-400">Categoria</label>
        <select
          value={categoryId}
          onChange={(e) => handleCategoryPick(e.target.value)}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
        >
          <option value="">Auto / nenhuma</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
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
