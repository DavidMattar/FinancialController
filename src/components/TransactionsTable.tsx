"use client";

// Tabela de transações reutilizada em várias páginas (dashboard, transações, receitas).
// Cada linha pode ser expandida para mostrar o detalhamento interno (itens da compra)
// através do componente TransactionItemsPanel.

import { Fragment, useState } from "react";
import { formatBRL, formatDate } from "@/lib/format";
import TransactionItemsPanel from "./TransactionItemsPanel";
import type { Category, Transaction } from "@/lib/types";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  // Se informado, a coluna "categoria" vira um <select> editável em vez de só exibir o nome.
  onCategoryChange?: (transactionId: string, categoryId: string | null) => void;
  // Se informado, mostra uma coluna extra com o botão "excluir".
  onDelete?: (transactionId: string) => void;
  onPendingReturnChange?: (transactionId: string, value: boolean) => void;
  // Se informado, cada linha ganha um botão "→ Família", que move a transação
  // para o ledger isolado da família. Só a página /transacoes passa esse
  // callback — no dashboard e em /receitas a tabela é somente de leitura.
  // Recebe a transação inteira (e não só o id, como onDelete) porque o diálogo
  // de confirmação precisa da descrição e do tipo para montar o aviso.
  onMoveToFamily?: (transaction: Transaction) => void;
}

// Tradução dos valores do enum TransactionType (banco de dados) para rótulos em português.
const TYPE_LABEL: Record<Transaction["type"], string> = {
  EXPENSE: "Despesa",
  INCOME: "Crédito",
  PAYMENT: "Pagamento",
};

export default function TransactionsTable({
  transactions,
  categories,
  onCategoryChange,
  onDelete,
  onPendingReturnChange,
  onMoveToFamily,
}: Props) {
  // Guarda o id da transação cuja linha de detalhamento está aberta (só uma por vez); null = nenhuma aberta.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (transactions.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">Nenhuma transação encontrada.</p>;
  }

  // O número de colunas da tabela muda conforme as colunas de ação presentes
  // (excluir e/ou mover para Família), e é usado no colSpan da linha de
  // detalhamento expandida para ela ocupar a largura toda.
  const columnCount = 6 + (onDelete ? 1 : 0) + (onMoveToFamily ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-4">Data</th>
            <th className="py-2 pr-4">Descrição</th>
            <th className="py-2 pr-4">Cartão</th>
            <th className="py-2 pr-4">Categoria</th>
            <th className="py-2 pr-4">Tipo</th>
            <th className="py-2 pr-4 text-right">Valor</th>
            {onMoveToFamily && <th className="py-2 pl-2" />}
            {onDelete && <th className="py-2 pl-2" />}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const expanded = expandedId === t.id;
            // "pendente de devolução": compra em e-commerce marcada manualmente para
            // acompanhamento (ex: aguardando estorno) — a linha fica destacada em vermelho.
            const pending = Boolean(t.pendingReturn);
            return (
              <Fragment key={t.id}>
                <tr
                  className={`border-b border-slate-100 dark:border-slate-700 ${
                    pending
                      ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  }`}
                >
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {formatDate(t.date)}
                  </td>
                  <td className="py-2 pr-4 max-w-xs">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : t.id)}
                      className={`flex items-center gap-1.5 text-left truncate hover:underline ${
                        pending ? "text-red-700 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
                      }`}
                      title={`${t.description} — clique para ver o detalhamento`}
                    >
                      <span className={`text-slate-400 dark:text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}>
                        ›
                      </span>
                      <span className="truncate">{t.description}</span>
                      {pending && <span title="Pendente de devolução">🔴</span>}
                    </button>
                    {t.installmentCurrent && t.installmentTotal ? (
                      <span className="text-slate-400 dark:text-slate-500 text-xs">
                        {" "}
                        ({t.installmentCurrent}/{t.installmentTotal})
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {t.creditCard ? `****${t.creditCard.lastDigits}` : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {onCategoryChange ? (
                      <select
                        value={t.categoryId ?? ""}
                        onChange={(e) => onCategoryChange(t.id, e.target.value || null)}
                        className="border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Sem categoria</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : t.category ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${t.category.color}1a`, color: t.category.color }}
                      >
                        {t.category.name}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">Sem categoria</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {TYPE_LABEL[t.type]}
                  </td>
                  <td
                    className={`py-2 pr-4 text-right whitespace-nowrap font-medium ${
                      pending
                        ? "text-red-700 dark:text-red-400"
                        : t.type === "EXPENSE"
                          ? "text-slate-900 dark:text-slate-100"
                          : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {t.type === "PAYMENT" ? "-" : ""}
                    {formatBRL(Number(t.amount))}
                  </td>
                  {onMoveToFamily && (
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => onMoveToFamily(t)}
                        title="Mover esta transação para o ledger de Transações Família"
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-xs whitespace-nowrap"
                      >
                        → Família
                      </button>
                    </td>
                  )}
                  {onDelete && (
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => onDelete(t.id)}
                        className="text-slate-400 hover:text-red-500 text-xs"
                      >
                        excluir
                      </button>
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <td colSpan={columnCount}>
                      <TransactionItemsPanel
                        transactionId={t.id}
                        transactionAmount={Number(t.amount)}
                        description={t.description}
                        hasCreditCard={Boolean(t.creditCardId)}
                        pendingReturn={pending}
                        onPendingReturnChange={onPendingReturnChange}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
