"use client";

// Barra de "visões salvas": permite ao usuário salvar o período de datas atual
// com um nome (ex: "Q1 2026") e reaplicá-lo depois com um clique.

import { useEffect, useState } from "react";
import type { DateRange } from "@/lib/dateRanges";

// Uma visão salva no banco: nome escolhido pelo usuário + o período (de/até) que ela representa.
interface View {
  id: string;
  name: string;
  filters: { from: string; to: string };
}

interface Props {
  currentRange: DateRange;
  onApply: (range: DateRange) => void;
}

export default function SavedViewsBar({ currentRange, onApply }: Props) {
  const [views, setViews] = useState<View[]>([]);
  // Desabilita o botão "salvar" enquanto a requisição está em andamento, evitando cliques duplicados.
  const [saving, setSaving] = useState(false);

  /** Busca a lista de visões salvas da API e atualiza o estado local. */
  async function loadViews() {
    const res = await fetch("/api/views");
    setViews(await res.json());
  }

  // Carrega as visões salvas uma única vez, quando o componente aparece na tela.
  useEffect(() => {
    loadViews();
  }, []);

  /** Pergunta um nome ao usuário (via prompt do navegador) e salva o período atual
   * (currentRange) como uma nova visão nomeada. */
  async function handleSave() {
    const name = window.prompt("Nome desta visualização:");
    if (!name) return;
    setSaving(true);
    try {
      await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters: currentRange }),
      });
      await loadViews();
    } finally {
      setSaving(false);
    }
  }

  /** Remove uma visão salva, depois de confirmar com o usuário. */
  async function handleDelete(id: string) {
    if (!window.confirm("Remover esta visualização salva?")) return;
    await fetch(`/api/views/${id}`, { method: "DELETE" });
    await loadViews();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-500 dark:text-slate-400">Visões salvas:</span>
      {views.map((view) => (
        <span
          key={view.id}
          className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-full pl-3 pr-1 py-1"
        >
          <button
            type="button"
            className="font-medium text-slate-700 dark:text-slate-200"
            onClick={() => onApply(view.filters)}
          >
            {view.name}
          </button>
          <button
            type="button"
            onClick={() => handleDelete(view.id)}
            className="text-slate-400 hover:text-red-500 px-1"
            aria-label="Remover"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-2.5 py-1 rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        + salvar período atual
      </button>
    </div>
  );
}
