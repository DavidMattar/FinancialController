"use client";

// Painel de importação de faturas de cartão de crédito (PDF).
// Fluxo em duas etapas, para o usuário poder revisar/editar antes de salvar:
//   1) "parse": envia o PDF para /api/invoices/parse, que extrai os
//      lançamentos e sugere uma categoria para cada um (sem gravar nada no banco);
//   2) "confirm": envia a lista (já revisada/editada pelo usuário — pode
//      desmarcar lançamentos, reescrever a descrição, trocar categorias e
//      marcar "verificar devolução") para /api/invoices/confirm, que
//      efetivamente cria as transações no banco.
// Atualmente só o banco Santander é suportado pelo parser.
//
// A descrição é editável porque o texto que vem da fatura é o do adquirente
// ("PAG*Loja1234"), que muitas vezes não diz nada — renomear aqui, antes de
// gravar, evita ter que abrir cada transação depois. A descrição original fica
// guardada em `parsedDescription` só para o botão de restaurar; ela nunca é
// enviada ao servidor. Renomear NÃO re-sugere categoria: a sugestão automática
// (por `Category.keywords`) acontece no parse, e daqui em diante a categoria é
// escolha explícita do usuário no select da mesma linha.

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

/**
 * Uma linha da tabela de revisão: o que veio do parser MAIS o estado de edição
 * da tela. Os dois campos extras são obrigatórios aqui (são preenchidos ao
 * montar as linhas, logo depois do parse), enquanto `PreviewTransaction`
 * descreve só o que a API devolve — é isso que dispensa fallback na hora de ler.
 */
interface EditableRow extends PreviewTransaction {
  /** Descrição como saiu do parser, para o "restaurar" da linha. Não vai para a API. */
  parsedDescription: string;
  /** Marca o lançamento como "verificar devolução" já na criação. */
  pendingReturn: boolean;
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

/**
 * Corpo de um lançamento no formato que /api/invoices/confirm espera: descrição
 * já aparada e sem `parsedDescription`, que é estado só desta tela (serve ao
 * botão "restaurar") e não tem lugar no schema da rota.
 */
function toConfirmPayload(row: EditableRow): Omit<EditableRow, "parsedDescription"> {
  // O tipo do alvo marca parsedDescription como opcional só para o operador
  // delete ser válido; o tipo de retorno declarado é que garante que ela não
  // sai daqui.
  const payload: Omit<EditableRow, "parsedDescription"> & { parsedDescription?: string } = {
    ...row,
    description: row.description.trim(),
  };
  delete payload.parsedDescription;
  return payload;
}

export default function InvoiceImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado da etapa de "parse" — dados gerais da fatura (não editáveis).
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  // Lançamentos extraídos, já editáveis pelo usuário (incluir/excluir, renomear,
  // mudar categoria, marcar devolução).
  const [rows, setRows] = useState<EditableRow[]>([]);
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
      setRows(
        data.transactions.map((t: PreviewTransaction) => ({
          ...t,
          categoryId: t.suggestedCategory?.id ?? null,
          include: true,
          parsedDescription: t.description,
          pendingReturn: false,
        })),
      );
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
          transactions: rows.filter((r) => r.include).map(toConfirmPayload),
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

  /** Atualiza um campo (incluir/excluir, descrição, categoria, devolução) de um lançamento específico na lista de preview. */
  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  /** Devolve a descrição de uma linha ao texto que veio do PDF. */
  function resetDescription(index: number) {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, description: r.parsedDescription } : r)),
    );
  }

  const includedCount = rows.filter((r) => r.include).length;
  // A rota de confirmação exige descrição não vazia (`z.string().min(1)`), então
  // apagar o texto de um lançamento incluído bloqueia o envio aqui — melhor que
  // receber um erro de validação depois de revisar a fatura inteira.
  const emptyDescriptionCount = rows.filter((r) => r.include && r.description.trim() === "").length;
  const pendingReturnCount = rows.filter((r) => r.include && r.pendingReturn).length;
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
                Lançamentos identificados ({includedCount} selecionados · {formatBRL(includedTotal)}
                {pendingReturnCount > 0 && ` · ${pendingReturnCount} p/ verificar devolução`})
              </h2>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || includedCount === 0 || emptyDescriptionCount > 0}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Salvando..." : "Confirmar importação"}
              </button>
            </div>
            {emptyDescriptionCount > 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
                {emptyDescriptionCount === 1
                  ? "Um lançamento selecionado está sem descrição — preencha ou desmarque para continuar."
                  : `${emptyDescriptionCount} lançamentos selecionados estão sem descrição — preencha ou desmarque para continuar.`}
              </p>
            )}
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
                    <th className="py-2 pr-2 text-center" title="Marcar para verificar devolução">
                      Dev.
                    </th>
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
                      <td className="py-1.5 pr-4">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={r.description}
                            onChange={(e) => updateRow(i, { description: e.target.value })}
                            aria-label={`Descrição do lançamento ${i + 1}`}
                            title={
                              r.description === r.parsedDescription
                                ? r.description
                                : `Original na fatura: ${r.parsedDescription}`
                            }
                            className={`w-[200px] border rounded-md px-2 py-1 text-xs dark:text-slate-100 ${
                              r.description !== r.parsedDescription
                                ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40"
                                : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900"
                            }`}
                          />
                          {/* Só aparece quando o texto foi mesmo alterado — mesmo padrão
                              do "restaurar" por noite no modal de aluguel. */}
                          <button
                            type="button"
                            onClick={() => resetDescription(i)}
                            disabled={r.description === r.parsedDescription}
                            aria-label={`Restaurar descrição original do lançamento ${i + 1}`}
                            title="Restaurar a descrição original da fatura"
                            className="text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-0 px-0.5"
                          >
                            ↺
                          </button>
                        </div>
                        {r.installmentCurrent && r.installmentTotal ? (
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            parcela {r.installmentCurrent}/{r.installmentTotal}
                          </span>
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
                      <td className="py-1.5 pr-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.pendingReturn}
                          onChange={(e) => updateRow(i, { pendingReturn: e.target.checked })}
                          aria-label={`Verificar devolução do lançamento ${i + 1}`}
                        />
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
