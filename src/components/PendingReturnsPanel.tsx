"use client";

// Painel que lista transações marcadas como "pendente de verificação" (ex: uma
// compra que ainda pode ser devolvida/estornada). Aparece destacado em vermelho
// quando há itens pendentes, para chamar atenção do usuário.

import { useEffect, useState } from "react";
import { formatBRL, formatDate } from "@/lib/format";
import type { Transaction } from "@/lib/types";

export default function PendingReturnsPanel() {
  // Lista de transações pendentes de verificação, carregada da API.
  const [items, setItems] = useState<Transaction[]>([]);
  // Evita mostrar "nenhum item pendente" por um instante antes da 1ª resposta da API.
  const [loading, setLoading] = useState(true);

  /** Busca na API todas as transações marcadas com pendingReturn = true. */
  async function load() {
    const res = await fetch("/api/transactions?pendingReturn=true");
    setItems(await res.json());
    setLoading(false);
  }

  // Carrega a lista uma única vez, quando o componente é montado.
  useEffect(() => {
    load();
  }, []);

  /** Marca a transação como resolvida (pendingReturn = false) e remove da lista local. */
  async function handleResolve(id: string) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pendingReturn: false }),
    });
    setItems((prev) => prev.filter((t) => t.id !== id));
  }

  if (loading) return null;
  if (items.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          🔴 Pendente de verificação — nenhum item pendente de devolução.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-2.5">
      <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1.5">
        🔴 Pendente de verificação ({items.length})
      </p>
      <ul className="divide-y divide-red-100 dark:divide-red-900/60">
        {items.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 py-1 text-sm">
            <span className="text-red-800 dark:text-red-300 truncate">
              {formatDate(t.date)} — {t.description}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-medium text-red-900 dark:text-red-200 whitespace-nowrap">
                {formatBRL(Number(t.amount))}
              </span>
              <button
                type="button"
                onClick={() => handleResolve(t.id)}
                className="text-xs text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
                title="Marcar como resolvido"
              >
                resolver
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
