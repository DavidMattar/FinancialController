"use client";

/**
 * Página "/categorias" — cria, lista, ordena e exclui categorias de
 * despesa/receita.
 * Cada categoria pode ter palavras-chave usadas na categorização automática
 * de lançamentos importados (ver `src/lib/categorize.ts`) e, se for despesa,
 * pode marcar "desconta dos 15%" (afeta o cálculo do orçamento em /receitas).
 * Categorias com sub-itens fixos associados (regra de negócio) são
 * protegidas contra exclusão — indicado pelo ícone de cadeado.
 *
 * A ORDEM da lista aqui é a ordem em que as categorias aparecem em todo o
 * app (selects da tabela de transações, filtros do dashboard e de
 * /relatorios, telas de importação), porque quem ordena é
 * `GET /api/categories` e todas elas renderizam na ordem recebida. As setas
 * ↑/↓ de cada linha gravam essa ordem por `PATCH /api/categories`.
 */
import { useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { Category } from "@/lib/types";

export default function CategoriasPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [keywords, setKeywords] = useState("");
  const [deductsFromFreeSpend, setDeductsFromFreeSpend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Categoria selecionada para exclusão, aguardando confirmação no ConfirmDialog.
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  // Mensagem de erro exibida quando o servidor recusa a exclusão (ex: categoria protegida/em uso).
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Recarrega a lista de categorias do servidor (já na ordem escolhida). */
  async function load() {
    const res = await fetch("/api/categories");
    setCategories(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  /** Cria uma nova categoria a partir dos campos do formulário e limpa o formulário em seguida. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          color,
          kind,
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          deductsFromFreeSpend: kind === "EXPENSE" ? deductsFromFreeSpend : false,
        }),
      });
      setName("");
      setKeywords("");
      setDeductsFromFreeSpend(false);
      load();
    } finally {
      setSubmitting(false);
    }
  }

  /** Confirma a exclusão pendente; se o servidor recusar (categoria em uso/protegida), mostra a mensagem de erro num segundo ConfirmDialog. */
  async function handleConfirmDelete() {
    // Guard de tipo: o diálogo de confirmação só é montado com uma categoria
    // selecionada, então este caminho não é alcançável pela interface.
    /* v8 ignore next */
    if (!categoryToDelete) return;
    const res = await fetch(`/api/categories/${categoryToDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json();
      setDeleteError(data.error ?? "Não foi possível excluir esta categoria.");
      setCategoryToDelete(null);
      return;
    }
    setCategoryToDelete(null);
    load();
  }

  /**
   * Move uma categoria uma posição para cima (`delta` -1) ou para baixo (+1).
   *
   * A lista da tela é reordenada ANTES da resposta do servidor (atualização
   * otimista, igual ao toggle dos 15%): o usuário costuma clicar a seta várias
   * vezes seguidas para levar a categoria até a posição desejada, e esperar
   * uma ida ao servidor por clique faria a linha "andar com atraso".
   *
   * O PATCH manda a ordem INTEIRA (todos os ids, na ordem nova), que é o que a
   * rota exige — assim `sortOrder` continua sendo uma permutação sem empate,
   * em vez de dois updates soltos que poderiam deixar duas categorias na mesma
   * posição se um deles falhasse.
   *
   * Movimento fora da lista (subir a primeira, descer a última) é ignorado; as
   * setas dessas linhas já vêm desabilitadas, então isso é só a garantia de que
   * um duplo clique rápido não gire a lista.
   */
  async function handleMove(index: number, delta: -1 | 1) {
    const target = index + delta;
    // Guard de limite: a seta da primeira linha e a da última vêm
    // desabilitadas, então a interface não consegue produzir este caminho — ele
    // está aqui para um índice fora da lista nunca virar uma posição vazia na
    // troca abaixo (que corromperia a ordem inteira).
    /* v8 ignore next */
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setCategories(reordered);
    await fetch("/api/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: reordered.map((c) => c.id) }),
    });
  }

  /** Alterna a flag "desconta dos 15%" direto na lista, com atualização otimista da UI antes da resposta do servidor. */
  async function handleToggleDeducts(category: Category) {
    const next = !category.deductsFromFreeSpend;
    setCategories((prev) => prev.map((c) => (c.id === category.id ? { ...c, deductsFromFreeSpend: next } : c)));
    await fetch(`/api/categories/${category.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deductsFromFreeSpend: next }),
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Categorias</h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end"
      >
        <div className="flex flex-col gap-1 col-span-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">Nome</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400">Cor</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="border border-slate-200 dark:border-slate-600 rounded-md h-9 w-full"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400">Tipo</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          >
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
          <label className="text-xs text-slate-500 dark:text-slate-400">Palavras-chave (vírgula)</label>
          <input
            type="text"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="UBER, 99APP"
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Adicionar
        </button>
        {kind === "EXPENSE" && (
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 col-span-2 sm:col-span-5 cursor-pointer">
            <input
              type="checkbox"
              checked={deductsFromFreeSpend}
              onChange={(e) => setDeductsFromFreeSpend(e.target.checked)}
              className="accent-indigo-600"
            />
            Descontar gastos desta categoria dos 15% livres para gastar
          </label>
        )}
      </form>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Use as setas ↑/↓ para definir a ordem em que as categorias aparecem nas listas de
        transações e nos filtros do app.
      </p>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-700">
        {categories.map((c, index) => {
          const protectedCategory = (c.fixedSubItems?.length ?? 0) > 0;
          return (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* As duas setas ficam empilhadas para não roubar largura da
                    linha; o rótulo acessível traz o nome da categoria porque a
                    lista tem uma seta dessas por linha. */}
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0}
                    aria-label={`Mover ${c.name} para cima`}
                    title="Mover para cima"
                    className="text-xs leading-none text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMove(index, 1)}
                    disabled={index === categories.length - 1}
                    aria-label={`Mover ${c.name} para baixo`}
                    title="Mover para baixo"
                    className="text-xs leading-none text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-30 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                  >
                    ↓
                  </button>
                </div>
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    {c.name}
                    {protectedCategory && (
                      <span title="Categoria com regra de negócio associada (sub-itens fixos) — não pode ser excluída">
                        🔒
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {c.kind === "INCOME" ? "Receita" : "Despesa"}
                    {c.keywords.length > 0 ? ` · ${c.keywords.join(", ")}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {c.kind === "EXPENSE" && (
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={c.deductsFromFreeSpend ?? false}
                      onChange={() => handleToggleDeducts(c)}
                      className="accent-indigo-600"
                    />
                    desconta dos 15%
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setCategoryToDelete(c)}
                  disabled={protectedCategory}
                  title={protectedCategory ? "Categoria protegida — não pode ser excluída" : undefined}
                  className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-400 disabled:cursor-not-allowed"
                >
                  excluir
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={categoryToDelete !== null}
        title="Excluir categoria"
        message={`Excluir "${categoryToDelete?.name}"? Transações associadas ficarão sem categoria.`}
        confirmLabel="Excluir"
        onConfirm={handleConfirmDelete}
        onCancel={() => setCategoryToDelete(null)}
      />

      <ConfirmDialog
        open={deleteError !== null}
        title="Não foi possível excluir"
        message={deleteError ?? ""}
        confirmLabel="Entendi"
        danger={false}
        onConfirm={() => setDeleteError(null)}
        onCancel={() => setDeleteError(null)}
      />
    </div>
  );
}
