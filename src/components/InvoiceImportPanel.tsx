"use client";

// Painel de importação de faturas de cartão de crédito (PDF).
// Fluxo em duas etapas, para o usuário poder revisar/editar antes de salvar:
//   1) "parse": envia o PDF para /api/invoices/parse, que extrai os
//      lançamentos e sugere uma categoria para cada um (sem gravar nada no banco);
//   2) "confirm": envia a lista (já revisada/editada pelo usuário — pode
//      desmarcar lançamentos ou trocar categorias) para /api/invoices/confirm,
//      que efetivamente cria as transações no banco.
// Atualmente só o banco Santander é suportado pelo parser.

import { useState } from "react";
import { formatBRL, formatDate } from "@/lib/format";

interface PreviewTransaction {
  date: string;
  description: string;
  amount: number;
  amountUsd?: number;
  type: "EXPENSE" | "INCOME" | "PAYMENT";
  section: "DESPESA" | "CREDITO" | "PARCELAMENTO";
  installmentCurrent?: number;
  installmentTotal?: number;
  cardHolder: string;
  cardLastDigits: string;
  suggestedCategory: { id: string; name: string; color: string } | null;
  categoryId?: string | null;
  include?: boolean;
}

interface PreviewResponse {
  bank: string;
  referenceMonth: string;
  dueDate?: string;
  totalAmount: number;
  minPayment?: number;
  computedTotal: number;
  fileName: string;
  cards: { holderName: string; lastDigits: string }[];
  transactions: PreviewTransaction[];
}

interface CategoryOption {
  id: string;
  name: string;
}

const SECTION_LABEL: Record<PreviewTransaction["section"], string> = {
  DESPESA: "Despesa",
  CREDITO: "Crédito/Pagamento",
  PARCELAMENTO: "Parcelamento",
};

export default function InvoiceImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado da etapa de "parse" — dados gerais da fatura (não editáveis).
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  // Lançamentos extraídos, já editáveis pelo usuário (incluir/excluir, mudar categoria).
  const [rows, setRows] = useState<PreviewTransaction[]>([]);
  // Cartão ao qual a fatura será vinculada, quando há mais de um cartão na mesma fatura.
  const [primaryCardKey, setPrimaryCardKey] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [result, setResult] = useState<{ transactionsImported: number } | null>(null);

  /** Carrega a lista de categorias disponíveis, usada nos seletores de categoria de cada lançamento. */
  async function loadCategories() {
    const res = await fetch("/api/categories");
    setCategories(await res.json());
  }

  /** Etapa 1: envia o PDF (e senha, se houver) para extração dos lançamentos, sem gravar nada ainda. */
  async function handleParse(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await loadCategories();
      const formData = new FormData();
      formData.append("file", file);
      if (password) formData.append("password", password);
      const res = await fetch("/api/invoices/parse", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao processar o PDF.");
        return;
      }
      setPreview(data);
      setRows(data.transactions.map((t: PreviewTransaction) => ({ ...t, categoryId: t.suggestedCategory?.id ?? null, include: true })));
      setPrimaryCardKey(`${data.cards[0]?.holderName}|${data.cards[0]?.lastDigits}`);
    } catch {
      setError("Erro de conexão ao processar o PDF.");
    } finally {
      setBusy(false);
    }
  }

  /** Etapa 2: envia os lançamentos revisados/editados para gravação definitiva no banco. */
  async function handleConfirm() {
    // Guard de tipo: o botão de confirmar só existe na tela de preview.
    /* v8 ignore next */
    if (!preview) return;
    const [holderName, lastDigits] = primaryCardKey.split("|");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank: preview.bank,
          referenceMonth: preview.referenceMonth,
          dueDate: preview.dueDate ?? null,
          totalAmount: preview.totalAmount,
          minPayment: preview.minPayment ?? null,
          fileName: preview.fileName,
          primaryCard: { holderName, lastDigits },
          transactions: rows.filter((r) => r.include),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar a fatura.");
        return;
      }
      setResult(data);
      setPreview(null);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  /** Atualiza um campo (incluir/excluir, categoria) de um lançamento específico na lista de preview. */
  function updateRow(index: number, patch: Partial<PreviewTransaction>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const includedCount = rows.filter((r) => r.include).length;
  const includedTotal = rows
    .filter((r) => r.include && r.type === "EXPENSE")
    .reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Bancos suportados atualmente: <strong>Santander</strong>. O PDF é processado localmente — nada é enviado
        para a internet, exceto o próprio processamento no seu servidor local.
      </p>

      {!preview && !result && (
        <form
          onSubmit={handleParse}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3 max-w-md"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Arquivo PDF da fatura</label>
            <input
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-slate-700 dark:text-slate-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Senha do PDF (geralmente seu CPF)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy || !file}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Processando..." : "Processar fatura"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      {result && (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-sm text-emerald-800 dark:text-emerald-300">
          {result.transactionsImported} transações importadas com sucesso.{" "}
          <button type="button" className="underline" onClick={() => setResult(null)}>
            Importar outra fatura
          </button>
        </div>
      )}

      {preview && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-slate-500 dark:text-slate-400">Banco</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{preview.bank}</p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Referência</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{preview.referenceMonth}</p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Vencimento</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">
                {preview.dueDate ? formatDate(preview.dueDate) : "—"}
              </p>
            </div>
            <div>
              <p className="text-slate-500 dark:text-slate-400">Total da fatura</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{formatBRL(preview.totalAmount)}</p>
            </div>
            {preview.cards.length > 1 && (
              <div className="col-span-2 sm:col-span-4">
                <label className="text-xs text-slate-500 dark:text-slate-400">
                  Cartão principal (para vincular a fatura)
                </label>
                <select
                  value={primaryCardKey}
                  onChange={(e) => setPrimaryCardKey(e.target.value)}
                  className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm mt-1 block"
                >
                  {preview.cards.map((c) => (
                    <option key={`${c.holderName}|${c.lastDigits}`} value={`${c.holderName}|${c.lastDigits}`}>
                      {c.holderName} — ****{c.lastDigits}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-medium text-slate-900 dark:text-slate-100">
                Lançamentos identificados ({includedCount} selecionados · {formatBRL(includedTotal)})
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
                    <th className="py-2 pr-4">Data</th>
                    <th className="py-2 pr-4">Descrição</th>
                    <th className="py-2 pr-4">Titular</th>
                    <th className="py-2 pr-4">Tipo</th>
                    <th className="py-2 pr-4">Categoria</th>
                    <th className="py-2 pr-4 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={i}
                      className={`border-b border-slate-100 dark:border-slate-700 ${!r.include ? "opacity-40" : ""}`}
                    >
                      <td className="py-1.5 pr-2">
                        <input
                          type="checkbox"
                          checked={r.include}
                          onChange={(e) => updateRow(i, { include: e.target.checked })}
                        />
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {formatDate(r.date)}
                      </td>
                      <td
                        className="py-1.5 pr-4 max-w-[220px] truncate text-slate-900 dark:text-slate-100"
                        title={r.description}
                      >
                        {r.description}
                        {r.installmentCurrent && r.installmentTotal ? (
                          <span className="text-slate-400 dark:text-slate-500"> ({r.installmentCurrent}/{r.installmentTotal})</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        ****{r.cardLastDigits}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {SECTION_LABEL[r.section]}
                      </td>
                      <td className="py-1.5 pr-4">
                        <select
                          value={r.categoryId ?? ""}
                          onChange={(e) => updateRow(i, { categoryId: e.target.value || null })}
                          className="border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-slate-900 dark:text-slate-100"
                        >
                          <option value="">Sem categoria</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">
                        {r.type === "EXPENSE" ? "" : "-"}
                        {formatBRL(r.amount)}
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
