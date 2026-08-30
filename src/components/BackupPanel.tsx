"use client";

// Bloco "Backup e restauração" exibido no fim da página /relatorios.
//
// Duas ações independentes:
// 1. Fazer backup: baixa um JSON com TODOS os dados do banco
//    (GET /api/backup/export) — é um link direto, o download acontece pelo
//    header Content-Disposition da rota, mesmo padrão do "Exportar CSV".
// 2. Restaurar backup: recebe um arquivo gerado por essa mesma tela e o aplica
//    de volta no banco (POST /api/backup/restore).
//
// A restauração segue o padrão de import em duas etapas do app (ver seção 6 do
// contexto.md): ao escolher o arquivo, ele é lido e validado NO NAVEGADOR e um
// resumo é exibido (data de geração + quantos registros de cada tipo), para o
// usuário confirmar que pegou o arquivo certo antes de qualquer gravação.
// Nada é enviado ao servidor até o clique final no diálogo de confirmação.

import { useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";

/** Modo de aplicação do arquivo — espelha `RestoreMode` de `src/lib/backup.ts`. */
type RestoreMode = "replace" | "merge";

/**
 * Forma mínima do arquivo de backup que ESTA TELA precisa conhecer, declarada
 * localmente de propósito: os tipos completos vivem em `src/lib/backup.ts`,
 * que importa o Prisma e não pode ser puxado por um componente de cliente.
 */
interface BackupPreview {
  formatVersion: number;
  app?: string;
  generatedAt?: string;
  counts?: Record<string, number>;
  data: Record<string, unknown[]>;
}

interface RestoreResult {
  mode: RestoreMode;
  inserted: Record<string, number>;
  totalInserted: number;
  fileCounts: Record<string, number>;
}

/**
 * Rótulo em português de cada tabela do backup, na ordem em que aparecem no
 * resumo. Duplica o `BACKUP_TABLE_LABEL` do servidor pelo mesmo motivo do
 * `BackupPreview` acima (não dá para importar `lib/backup.ts` no cliente).
 */
const TABLE_LABEL: Record<string, string> = {
  categories: "Categorias",
  creditCards: "Cartões de crédito",
  invoices: "Faturas",
  transactions: "Transações",
  transactionItems: "Sub-itens de transação",
  investmentHoldings: "Investimentos",
  dashboardViews: "Views salvas",
  familyTransactions: "Transações Família",
  rentalSettlements: "Repasses de aluguel",
  seasonalRentals: "Aluguéis de temporada",
  seasonalRentalExpenses: "Gastos extras de aluguel",
};

const TABLE_ORDER = Object.keys(TABLE_LABEL);

/** Formata o `generatedAt` (ISO completo) como data e hora locais. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export default function BackupPanel() {
  // Arquivo escolhido e seu conteúdo já lido/validado (etapa de preview).
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<RestoreMode>("replace");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RestoreResult | null>(null);

  /**
   * Etapa 1 da restauração: lê o arquivo escolhido no próprio navegador e faz
   * uma checagem de sanidade (é JSON? tem `formatVersion` e `data`?). Um erro
   * aqui evita mandar um arquivo errado — uma foto, um CSV — para o servidor.
   */
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setError(null);
    setResult(null);
    setPreview(null);
    setFileName(file?.name ?? null);
    if (!file) return;

    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidate = parsed as BackupPreview | null;
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.formatVersion !== "number" ||
        typeof candidate.data !== "object" ||
        candidate.data === null
      ) {
        setError("Este arquivo não parece ser um backup gerado por este app.");
        return;
      }
      setPreview(candidate);
    } catch {
      setError("Não foi possível ler o arquivo: ele não é um JSON válido.");
    }
  }

  /**
   * Etapa 2: envia o arquivo inteiro para a rota de restauração, no modo
   * escolhido. O servidor valida de novo (a checagem do navegador é só de
   * conveniência) e aplica tudo em uma única transação.
   */
  async function handleRestore() {
    // Guard de tipo: o botão de restaurar só é renderizado depois de o arquivo
    // ser lido e validado, então aqui o preview nunca é nulo.
    /* v8 ignore next */
    if (!preview) return;
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/backup/restore?mode=${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Erro ao restaurar o backup.");
        return;
      }
      setResult(data as RestoreResult);
      setPreview(null);
      setFileName(null);
    } catch {
      setError("Erro de conexão ao restaurar o backup.");
    } finally {
      setBusy(false);
    }
  }

  // Contagem por tabela do arquivo escolhido: usa o `counts` do próprio
  // arquivo quando existe e, se não, conta os registros de `data` na mão.
  const previewCounts: Record<string, number> = {};
  if (preview) {
    for (const key of TABLE_ORDER) {
      previewCounts[key] = preview.counts?.[key] ?? (preview.data[key]?.length ?? 0);
    }
  }
  const previewTotal = Object.values(previewCounts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-4">
      <div>
        <h2 className="font-medium text-slate-900 dark:text-slate-100">Backup e restauração</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Gere um arquivo JSON com todos os dados do sistema antes de mexer em algo que afete o
          banco, e use esse mesmo arquivo para voltar atrás se precisar. Os identificadores são
          preservados, então as ligações entre transações, categorias, faturas e aluguéis
          continuam válidas depois de restaurar.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ------------------------------ Fazer backup ------------------------------ */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">Fazer backup</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Baixa um arquivo com o retrato atual de todas as tabelas: transações e sub-itens,
              categorias, cartões, faturas, investimentos, views salvas, Transações Família,
              aluguéis de temporada (com gastos extras e diárias customizadas) e repasses.
            </p>
          </div>
          <a
            href="/api/backup/export"
            className="inline-block px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Baixar backup (JSON)
          </a>
        </div>

        {/* ---------------------------- Restaurar backup ---------------------------- */}
        <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
          <div>
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Restaurar backup
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Escolha um arquivo gerado aqui. Você vê um resumo do conteúdo antes de confirmar, e
              nada é gravado até você confirmar.
            </p>
          </div>

          <input
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={busy}
            className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-slate-100 dark:file:bg-slate-700 file:text-slate-700 dark:file:text-slate-200 hover:file:bg-slate-200 dark:hover:file:bg-slate-600"
          />

          {preview && (
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {fileName}
                  {preview.generatedAt && <> — gerado em {formatDateTime(preview.generatedAt)}</>}
                </p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                  {previewTotal} registro{previewTotal === 1 ? "" : "s"} no arquivo
                </p>
                <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-xs text-slate-600 dark:text-slate-300">
                  {TABLE_ORDER.filter((key) => previewCounts[key] > 0).map((key) => (
                    <li key={key} className="flex justify-between gap-2">
                      <span>{TABLE_LABEL[key]}</span>
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">
                        {previewCounts[key]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Como aplicar
                </legend>
                <label className="flex gap-2 items-start text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="restore-mode"
                    value="replace"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                    className="mt-0.5 accent-indigo-600"
                  />
                  <span>
                    <span className="text-slate-700 dark:text-slate-200">Substituir tudo</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Apaga os dados atuais e deixa o sistema idêntico ao momento do backup. É a
                      opção para desfazer uma mudança que deu errado.
                    </span>
                  </span>
                </label>
                <label className="flex gap-2 items-start text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="restore-mode"
                    value="merge"
                    checked={mode === "merge"}
                    onChange={() => setMode("merge")}
                    className="mt-0.5 accent-indigo-600"
                  />
                  <span>
                    <span className="text-slate-700 dark:text-slate-200">
                      Só adicionar o que falta
                    </span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Mantém os dados atuais e insere apenas os registros do arquivo que não
                      existem mais. Útil para recuperar algo apagado sem perder o que foi lançado
                      depois do backup.
                    </span>
                  </span>
                </label>
              </fieldset>

              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={busy}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Restaurando..." : "Restaurar backup"}
              </button>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">{error}</p>
          )}

          {result && (
            <div className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-3 space-y-2">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Backup restaurado: {result.totalInserted} registro
                {result.totalInserted === 1 ? "" : "s"} inserido
                {result.totalInserted === 1 ? "" : "s"}
                {result.mode === "merge" && " (os que já existiam foram mantidos)"}.
              </p>
              {/* As outras telas do app ainda estão com os dados de antes em
                  memória, então recarregar é o caminho mais honesto aqui. */}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Recarregar a página
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={mode === "replace" ? "Substituir todos os dados?" : "Adicionar os dados que faltam?"}
        message={
          mode === "replace"
            ? `Todos os dados atuais do sistema serão APAGADOS e substituídos pelos ${previewTotal} registros do arquivo "${fileName}". Não há como desfazer isso a não ser restaurando outro backup.`
            : `Os ${previewTotal} registros do arquivo "${fileName}" serão inseridos, mantendo tudo o que já existe. Registros que já estão no sistema são ignorados.`
        }
        confirmLabel={mode === "replace" ? "Apagar e restaurar" : "Adicionar"}
        danger={mode === "replace"}
        onConfirm={handleRestore}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
