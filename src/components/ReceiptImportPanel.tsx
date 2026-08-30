"use client";

// Painel de importação de notas fiscais de consumidor eletrônica (NFC-e),
// aceitando um PDF salvo da página do QR code ou o texto colado da página.
// Mesmo fluxo em duas etapas do InvoiceImportPanel: "parse" (extrai os
// produtos e sugere data/categoria, sem gravar nada) e "confirm" (grava uma
// única transação, com os produtos selecionados como sub-itens apenas
// visuais — os itens não entram em relatórios/métricas, só a transação).
// Suporta apenas notas do padrão NFC-e (Sefaz).

import { useState } from "react";
import { formatBRL } from "@/lib/format";

interface PreviewItem {
  description: string;
  code: string;
  quantity: number;
  unit: string;
  amount: number;
  include?: boolean;
}

interface PreviewResponse {
  storeName: string;
  cnpj: string | null;
  date: string | null;
  officialTotal: number | null;
  computedTotal: number;
  suggestedCategoryId: string | null;
  items: PreviewItem[];
}

interface CategoryOption {
  id: string;
  name: string;
}

export default function ReceiptImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [date, setDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [result, setResult] = useState<{ itemsImported: number; totalAmount: number } | null>(null);

  /** Carrega a lista de categorias disponíveis, para o seletor de categoria da transação. */
  async function loadCategories() {
    const res = await fetch("/api/categories");
    setCategories(await res.json());
  }

  /** Etapa 1: envia o PDF ou o texto colado para extração dos produtos, sem gravar nada ainda. */
  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!file && !pastedText.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await loadCategories();
      const formData = new FormData();
      if (file) formData.append("file", file);
      else formData.append("text", pastedText);
      const res = await fetch("/api/receipts/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao processar a nota fiscal.");
        return;
      }
      setPreview(data);
      setItems(data.items.map((i: PreviewItem) => ({ ...i, include: true })));
      setDate(data.date ? new Date(data.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      setCategoryId(data.suggestedCategoryId ?? "");
    } catch {
      setError("Erro de conexão ao processar a nota fiscal.");
    } finally {
      setBusy(false);
    }
  }

  /** Etapa 2: envia os itens revisados/editados (data, categoria, itens incluídos) para gravação definitiva. */
  async function handleConfirm() {
    // Guard de tipo: o botão de confirmar só existe na tela de preview.
    /* v8 ignore next */
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/receipts/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          storeName: preview.storeName,
          categoryId: categoryId || null,
          items: items
            .filter((i) => i.include)
            .map((i) => ({ description: i.description, amount: i.amount })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar a nota fiscal.");
        return;
      }
      setResult(data);
      setPreview(null);
      setItems([]);
      setFile(null);
      setPastedText("");
    } finally {
      setBusy(false);
    }
  }

  /** Atualiza um campo (incluir/excluir) de um item específico na lista de preview. */
  function updateItem(index: number, patch: Partial<PreviewItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const includedCount = items.filter((i) => i.include).length;
  const includedTotal = items.filter((i) => i.include).reduce((sum, i) => sum + i.amount, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Suporta notas NFC-e (Sefaz) — envie o PDF salvo da página do QR code, ou cole o texto copiado da página.
        Cada produto vira um sub-item da transação, apenas visual (não entra em relatórios).
      </p>

      {!preview && !result && (
        <form
          onSubmit={handleParse}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3 max-w-md"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Arquivo PDF da nota fiscal</label>
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                if (e.target.files?.[0]) setPastedText("");
              }}
              className="text-sm text-slate-700 dark:text-slate-300"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
            <span className="flex-1 border-t border-slate-200 dark:border-slate-700" />
            ou
            <span className="flex-1 border-t border-slate-200 dark:border-slate-700" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Colar texto da nota</label>
            <textarea
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                if (e.target.value) setFile(null);
              }}
              rows={4}
              placeholder="Cole aqui o texto copiado da página da nota fiscal..."
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy || (!file && !pastedText.trim())}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Processando..." : "Processar nota fiscal"}
          </button>
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}

      {result && (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-emerald-800 dark:text-emerald-300">
          Transação criada com {result.itemsImported} itens, total {formatBRL(result.totalAmount)}.{" "}
          <button type="button" className="underline" onClick={() => setResult(null)}>
            Importar outra nota
          </button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div className="col-span-2">
              <p className="text-slate-500 dark:text-slate-400">Estabelecimento</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{preview.storeName}</p>
            </div>
            <div>
              <label className="text-slate-500 dark:text-slate-400 text-xs">Data</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1 text-sm mt-1 block [color-scheme:light] dark:[color-scheme:dark]"
              />
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Total identificado</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{formatBRL(preview.computedTotal)}</p>
            </div>
            <div className="col-span-2 sm:col-span-4">
              <label className="text-xs text-slate-500 dark:text-slate-400">Categoria da transação</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm mt-1 block"
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-medium text-slate-900 dark:text-slate-100">
                Itens identificados ({includedCount} selecionados · {formatBRL(includedTotal)})
              </h2>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || includedCount === 0}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Salvando..." : "Confirmar importação"}
              </button>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white dark:bg-slate-800">
                  <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 pr-2"></th>
                    <th className="py-2 pr-4">Produto</th>
                    <th className="py-2 pr-4">Qtd.</th>
                    <th className="py-2 pr-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr
                      key={i}
                      className={`border-b border-slate-100 dark:border-slate-700 ${!item.include ? "opacity-40" : ""}`}
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={item.include}
                          onChange={(e) => updateItem(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="py-1.5 pr-4 text-slate-900 dark:text-slate-100">{item.description}</td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {item.quantity} {item.unit}
                      </td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">
                        {formatBRL(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
