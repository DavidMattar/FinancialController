"use client";

// Painel expansível (dentro de uma linha da TransactionsTable) para detalhar uma
// transação item por item (ex: dividir uma compra de supermercado em "arroz",
// "feijão", etc.). É puramente informativo/visual: os itens não entram em
// relatórios, métricas ou no orçamento — servem só para o usuário conferir a fatura.

import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";
import { isEcommerceMerchant } from "@/lib/ecommerceMerchants";
import { parseDecimalInput } from "@/lib/decimalInput";
import ParsedValueHint from "@/components/ParsedValueHint";

// Um item de detalhamento salvo no banco (tabela TransactionItem).
interface Item {
  id: string;
  description: string;
  amount: string | number;
}

interface Props {
  transactionId: string;
  // Categoria da transação. Não é usada na tela: serve para o painel recarregar
  // quando ela muda, porque a categoria nova pode ter criado sub-itens fixos no
  // servidor (`ensureFixedSubItems`, ex.: "Viagem"). Antes a troca de categoria
  // recarregava a lista toda e fechava o painel, então a próxima abertura já
  // vinha com eles; agora a linha é atualizada no lugar e o painel continua
  // aberto.
  categoryId?: string | null;
  transactionAmount: number;
  description: string;
  hasCreditCard: boolean;
  pendingReturn: boolean;
  onPendingReturnChange?: (transactionId: string, value: boolean) => void;
}

export default function TransactionItemsPanel({
  transactionId,
  categoryId,
  transactionAmount,
  description: transactionDescription,
  hasCreditCard,
  pendingReturn,
  onPendingReturnChange,
}: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  // Campos do formulário "adicionar item".
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Valor de sub-item que não descreve um número (ver src/lib/decimalInput.ts).
  const [amountError, setAmountError] = useState(false);
  // Cópia local do checkbox "pendente de devolução", para o checkbox responder
  // instantaneamente ao clique sem esperar a resposta da API (otimista).
  const [pendingReturnLocal, setPendingReturnLocal] = useState(pendingReturn);
  const [savingPendingReturn, setSavingPendingReturn] = useState(false);

  /** Busca a lista de itens de detalhamento desta transação. */
  async function load() {
    const res = await fetch(`/api/transactions/${transactionId}/items`);
    setItems(await res.json());
    setLoading(false);
  }

  // Recarrega os itens sempre que o painel é aberto para uma transação diferente
  // (o mesmo componente é reaproveitado ao trocar qual linha está expandida) e
  // também quando a categoria da transação muda, pelo motivo explicado em Props.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, categoryId]);

  /**
   * Envia o formulário de novo item: cria o item via API e limpa os campos.
   * O valor passa por `parseDecimalInput` (vírgula ou ponto como separador
   * decimal, ver `src/lib/decimalInput.ts`); valor ilegível avisa na tela.
   */
  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!description || !amount) return;
    const parsedAmount = parseDecimalInput(amount);
    if (parsedAmount === null) {
      setAmountError(true);
      return;
    }
    setAmountError(false);
    setSubmitting(true);
    try {
      await fetch(`/api/transactions/${transactionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, amount: parsedAmount }),
      });
      setDescription("");
      setAmount("");
      load();
    } finally {
      setSubmitting(false);
    }
  }

  /** Remove um item de detalhamento. */
  async function handleDelete(itemId: string) {
    await fetch(`/api/transactions/${transactionId}/items/${itemId}`, { method: "DELETE" });
    load();
  }

  /** Marca/desmarca a transação como "pendente de devolução" e avisa o componente
   * pai (TransactionsTable) para que a linha correspondente mude de cor imediatamente. */
  async function handlePendingReturnToggle(checked: boolean) {
    setPendingReturnLocal(checked);
    setSavingPendingReturn(true);
    try {
      await fetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingReturn: checked }),
      });
      onPendingReturnChange?.(transactionId, checked);
    } finally {
      setSavingPendingReturn(false);
    }
  }

  // Soma dos itens cadastrados e a diferença em relação ao valor total da transação —
  // ajuda o usuário a perceber se esqueceu de lançar algum item da compra.
  const sum = items.reduce((total, item) => total + Number(item.amount), 0);
  const diff = transactionAmount - sum;
  // A opção de marcar "pendente de devolução" só faz sentido para compras feitas com
  // cartão de crédito em um site de e-commerce reconhecido (ver ecommerceMerchants.ts).
  const showPendingReturnOption = hasCreditCard && isEcommerceMerchant(transactionDescription);

  return (
    <div className="py-3 px-2 space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Detalhamento interno — apenas visual, não entra em relatórios ou métricas.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">Nenhum item adicionado ainda.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700 max-w-md">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-slate-700 dark:text-slate-300">{item.description}</span>
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {formatBRL(Number(item.amount))}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md flex justify-between">
          <span>Soma dos itens: {formatBRL(sum)}</span>
          {Math.abs(diff) > 0.005 ? (
            <span className="text-amber-600 dark:text-amber-400">
              {diff > 0 ? `faltam ${formatBRL(diff)}` : `excede ${formatBRL(-diff)}`} p/ bater com {formatBRL(transactionAmount)}
            </span>
          ) : (
            <span className="text-emerald-600 dark:text-emerald-400">bate com o valor da transação ✓</span>
          )}
        </p>
      )}

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 max-w-md">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <label className="text-xs text-slate-500 dark:text-slate-400">Item</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="ex: tomate"
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1 w-28">
          <label className="text-xs text-slate-500 dark:text-slate-400">Valor (R$)</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          />
          <ParsedValueHint raw={amount} kind="money" />
          {amountError && (
            <p className="text-xs text-red-600 dark:text-red-400">Use vírgula ou ponto.</p>
          )}
        </div>
        <button
          type="submit"
          disabled={submitting || !description || !amount}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Adicionar
        </button>
      </form>

      {showPendingReturnOption && (
        <label className="flex items-center gap-2 text-sm max-w-md pt-2 border-t border-slate-200 dark:border-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={pendingReturnLocal}
            disabled={savingPendingReturn}
            onChange={(e) => handlePendingReturnToggle(e.target.checked)}
            className="accent-red-600"
          />
          <span className="text-slate-700 dark:text-slate-300">
            Item pendente de devolução{" "}
            <span className="text-slate-400 dark:text-slate-500">
              (compra em e-commerce — marca a transação em vermelho e lista em &quot;Pendente de verificação&quot;)
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
