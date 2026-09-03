"use client";

/**
 * Página "/transacoes" — lista completa de transações (despesas, receitas e
 * pagamentos de fatura) com filtros por período, categoria, tipo e busca por
 * texto. Também permite criar uma transação manualmente através do
 * formulário `ManualTransactionForm`, definido mais abaixo neste arquivo, e
 * mover uma transação para o ledger isolado da família.
 */
import { useEffect, useRef, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import DateRangePicker from "@/components/DateRangePicker";
import TransactionsTable from "@/components/TransactionsTable";
import { currentMonthRange, type DateRange } from "@/lib/dateRanges";
import {
  matchesTransactionFilters,
  sortTransactionsByDateDesc,
  type TransactionFilters,
} from "@/lib/transactionFilters";
import type { Category, Transaction } from "@/lib/types";
import { parseDecimalInput } from "@/lib/decimalInput";
import ParsedValueHint from "@/components/ParsedValueHint";

export default function TransacoesPage() {
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState("");
  const [query, setQuery] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Transação aguardando confirmação de movimentação para a família (null = nenhuma).
  const [toMove, setToMove] = useState<Transaction | null>(null);
  const [moving, setMoving] = useState(false);

  // Carrega as categorias uma única vez, para popular o filtro e o formulário.
  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then(setCategories);
  }, []);

  // Os filtros ativos reunidos no formato que `matchesTransactionFilters` usa —
  // é com eles que a tela decide se uma transação editada continua na lista.
  const filters: TransactionFilters = { from: range.from, to: range.to, categoryId, type, query };

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

  /**
   * Grava um campo editado direto na tabela. As três edições inline (categoria,
   * data e descrição) são o MESMO PATCH com uma chave diferente, então o corpo
   * já chega montado por quem chamou.
   *
   * **Atualiza só a linha editada, sem recarregar a lista.** Recarregar troca a
   * tabela inteira por "Carregando...", o que fecha o detalhamento aberto e
   * remonta o campo que está sendo editado — barulho visual a cada tecla de
   * Enter. A linha nova vem da RESPOSTA do PATCH, e não do que foi enviado,
   * porque a rota pode mudar mais do que se pediu: categoria de receita força
   * `type: INCOME` (seção 4.4 do contexto.md) e a resposta já traz categoria e
   * cartão populados, do mesmo jeito que a listagem.
   *
   * Se a transação atualizada não casa mais com os filtros ativos (data fora do
   * período, categoria ou tipo filtrados, busca por texto), ela sai da lista —
   * o mesmo resultado que o recarregamento dava. E a lista é reordenada por
   * data, porque editar a data muda o lugar da linha na tabela.
   *
   * Resposta fora de 2xx não aplica nada: o corpo é um objeto de erro, não a
   * transação, e o pop-up global já explica a falha (ver src/lib/logClient.ts).
   */
  async function patchTransaction(id: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return;
    const updated: Transaction = await res.json();
    setTransactions((prev) => {
      if (!matchesTransactionFilters(updated, filters)) {
        return prev.filter((t) => t.id !== updated.id);
      }
      return sortTransactionsByDateDesc(prev.map((t) => (t.id === updated.id ? updated : t)));
    });
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

  /**
   * Confirma a movimentação para o ledger da família: a rota cria a
   * `FamilyTransaction` e apaga a `Transaction` na mesma transação do banco, então
   * aqui basta recarregar a lista — a transação movida simplesmente não volta.
   */
  async function handleConfirmMove() {
    // Guard de tipo: o diálogo só abre com uma transação selecionada.
    /* v8 ignore next */
    if (!toMove) return;
    setMoving(true);
    try {
      await fetch(`/api/transactions/${toMove.id}/move-to-family`, { method: "POST" });
      setToMove(null);
      load();
    } finally {
      setMoving(false);
    }
  }

  /**
   * Texto do diálogo de confirmação. É explícito sobre o que se perde porque o
   * ledger da família é isolado de propósito (não tem categoria, cartão,
   * fatura, parcelamento nem devolução pendente) e o movimento não tem desfazer.
   */
  function moveMessage(t: Transaction): string {
    const linhas = [
      `Mover "${t.description}" para Transações Família?`,
      "",
      "A transação sai do ledger principal (deixa de contar em relatórios, métricas e orçamento) e passa a existir só no ledger da família.",
      "Categoria, cartão, fatura, parcelamento, devolução pendente e sub-itens são perdidos — o ledger da família não tem esses campos.",
    ];
    if (t.type === "PAYMENT") {
      linhas.push(
        "",
        'Esta transação é do tipo Pagamento, que não existe no ledger da família — ela entrará como Despesa.',
      );
    }
    linhas.push("", "Não há como desfazer pela interface.");
    return linhas.join("\n");
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
          // Quem decide se o formulário continua aberto é o checkbox
          // "continuar lançando" DENTRO dele — a página só obedece. A lista
          // recarrega nos dois casos: o lançamento novo tem que aparecer atrás
          // do formulário que ficou aberto.
          onCreated={(keepOpen) => {
            if (!keepOpen) setShowForm(false);
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
            onCategoryChange={(id, newCategoryId) => patchTransaction(id, { categoryId: newCategoryId })}
            onDateChange={(id, date) => patchTransaction(id, { date })}
            onDescriptionChange={(id, description) => patchTransaction(id, { description })}
            onDelete={handleDelete}
            onPendingReturnChange={handlePendingReturnChange}
            onMoveToFamily={setToMove}
          />
        )}
      </div>

      <ConfirmDialog
        open={toMove !== null}
        title="Mover para Transações Família"
        message={toMove ? moveMessage(toMove) : ""}
        confirmLabel={moving ? "Movendo..." : "Mover"}
        danger={false}
        onConfirm={handleConfirmMove}
        onCancel={() => setToMove(null)}
      />
    </div>
  );
}

/**
 * Formulário de criação manual de transação, usado dentro de "/transacoes"
 * quando o usuário clica em "+ Nova transação". Ao escolher uma categoria de
 * receita, o tipo é travado automaticamente em "Crédito" (ver `handleCategoryPick`),
 * pois não faz sentido lançar uma despesa numa categoria de receita.
 *
 * O checkbox "continuar lançando" existe para o caso de lançar VÁRIAS
 * transações seguidas (o normal quando se senta para pôr o mês em dia): com ele
 * marcado, salvar não fecha o formulário — limpa só o que muda de um
 * lançamento para o outro e devolve o foco para a descrição, pronto para o
 * próximo. Sem ele, o comportamento é o de antes (salvar fecha).
 */
function ManualTransactionForm({
  categories,
  onCreated,
}: {
  categories: Category[];
  onCreated: (keepOpen: boolean) => void;
}) {
  // "Verificar devolução" já na criação. Sem a trava de e-commerce que o painel
  // da transação existente usa (ver TransactionItemsPanel): na hora de lançar,
  // quem decide o que precisa de acompanhamento é o usuário — pode ser uma
  // compra em loja física, um serviço, um adiantamento.
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [pendingReturn, setPendingReturn] = useState(false);
  const [type, setType] = useState<"EXPENSE" | "INCOME" | "PAYMENT">("EXPENSE");
  const [submitting, setSubmitting] = useState(false);
  // Valor digitado que não descreve um número: avisa na tela em vez de enviar
  // NaN (que o JSON.stringify vira null) e tomar um 400 que a tela não mostrava.
  const [amountError, setAmountError] = useState(false);
  // "Continuar lançando": mantém o formulário aberto depois de salvar.
  const [keepOpen, setKeepOpen] = useState(false);
  // Quantos lançamentos já foram salvos nesta sessão do formulário. Existe
  // porque, com o formulário aberto, "salvou?" deixa de ser óbvio: o
  // formulário cobre a lista que acabou de mudar, e os campos limpos são o
  // mesmo estado visual de um formulário que nunca foi enviado.
  const [savedCount, setSavedCount] = useState(0);
  // Para devolver o foco à descrição depois de salvar — o campo por onde todo
  // lançamento começa. Sem isso, "continuar lançando" ainda exigiria um clique
  // por transação, que é justamente o incômodo que o checkbox resolve.
  const descriptionRef = useRef<HTMLInputElement>(null);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // Se a categoria escolhida for do tipo receita, o campo "Tipo" fica travado/desabilitado.
  const incomeLocked = selectedCategory?.kind === "INCOME";

  /** Ao escolher uma categoria, força o tipo para "Crédito" se a categoria for de receita. */
  function handleCategoryPick(id: string) {
    setCategoryId(id);
    const category = categories.find((c) => c.id === id);
    if (category?.kind === "INCOME") setType("INCOME");
  }

  /**
   * Envia a nova transação para a API. O valor passa por `parseDecimalInput`
   * (`src/lib/decimalInput.ts`), que aceita vírgula ou ponto como separador
   * decimal e também entende separador de milhar ("1.234,56").
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseDecimalInput(amount);
    if (parsedAmount === null) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          description,
          amount: parsedAmount,
          type,
          categoryId: categoryId || null,
          pendingReturn,
        }),
      });
      // Resposta fora de 2xx não limpa nem fecha nada: o que foi digitado fica
      // na tela para ser corrigido, em vez de sumir junto com o erro. A falha
      // em si não fica escondida — o pop-up global cobre qualquer fetch.
      if (!res.ok) return;
      setSavedCount((n) => n + 1);
      if (keepOpen) {
        // Limpa só o que muda de um lançamento para o outro. Data, tipo e
        // categoria FICAM: quem lança várias seguidas costuma estar lançando o
        // mesmo dia (ou a mesma categoria), e reescrever isso a cada linha
        // anularia o ganho do checkbox.
        setDescription("");
        setAmount("");
        setPendingReturn(false);
        // Guard de tipo: o formulário continua montado neste caminho, então a
        // ref sempre aponta para o campo — a interface não produz o caso nulo.
        /* v8 ignore next */
        descriptionRef.current?.focus();
      }
      onCreated(keepOpen);
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
          ref={descriptionRef}
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
        {/* Eco do valor interpretado: resolve a ambiguidade de "1.000"
            mostrando o que o sistema entendeu, em vez de adivinhar. */}
        <ParsedValueHint raw={amount} kind="money" />
        {amountError && (
          <p className="text-xs text-red-600 dark:text-red-400">
            Valor inválido — use vírgula ou ponto (ex: 3,07).
          </p>
        )}
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
      <div className="col-span-2 sm:col-span-4 flex flex-col gap-1">
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={pendingReturn}
            onChange={(e) => setPendingReturn(e.target.checked)}
          />
          Verificar devolução (item pendente de acompanhamento)
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={keepOpen}
            onChange={(e) => setKeepOpen(e.target.checked)}
            className="accent-indigo-600"
          />
          Continuar lançando (mantém o formulário aberto para o próximo)
        </label>
      </div>
      <div className="flex flex-col gap-1 items-start">
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Salvar
        </button>
        {savedCount > 0 && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            ✓ {savedCount} {savedCount === 1 ? "lançamento salvo" : "lançamentos salvos"}
          </p>
        )}
      </div>
    </form>
  );
}
