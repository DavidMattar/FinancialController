"use client";

// Modal (janela sobreposta) para registrar um novo aluguel de temporada
// (Airbnb ou Booking). Enquanto o usuário digita, o formulário consulta a API
// de preview para mostrar em tempo real os valores calculados: 10% do David
// (mínimo garantido — nunca cai abaixo disso mesmo se o aluguel saiu mais
// barato que a tabela), o valor de tabela, e o valor líquido para distribuição
// entre a família. Ao salvar, o backend também cria automaticamente uma
// transação de receita (Total David) na categoria "Aluguel Rancho".

import { useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";

interface ExpenseRow {
  description: string;
  amount: string;
}

/** Formato devolvido por POST /api/seasonal-rentals/preview — os mesmos números que serão salvos ao confirmar. */
interface Preview {
  nights: number;
  tableValue: number;
  davidTenPercent: number;
  extrasTotal: number;
  extraTableValue: number;
  totalDavid: number;
  netForDistribution: number;
  /** Valor de limpeza sugerido pela API (hoje um valor fixo de R$180, mas editável pelo usuário). */
  suggestedCleaningFee: number;
}

interface Props {
  onClose: () => void;
  /** Chamado depois que o aluguel é salvo com sucesso, para o componente pai recarregar a lista. */
  onCreated: () => void;
}

export default function SeasonalRentalModal({ onClose, onCreated }: Props) {
  const [platform, setPlatform] = useState<"AIRBNB" | "BOOKING">("AIRBNB");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [netAmountReceived, setNetAmountReceived] = useState("");
  const [cleaningFee, setCleaningFee] = useState("");
  // Vira true assim que o usuário edita manualmente o campo de limpeza — a
  // partir daí o valor sugerido pela API deixa de sobrescrever o que foi digitado.
  const [cleaningFeeTouched, setCleaningFeeTouched] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Soma dos gastos extras digitados, aceitando tanto vírgula quanto ponto decimal.
  const extrasTotal = expenses.reduce((sum, e) => sum + (Number(e.amount.replace(",", ".")) || 0), 0);

  // Sempre que os campos relevantes mudam, recalcula o preview na API depois de
  // 300ms sem digitação (debounce), para não disparar uma requisição a cada tecla.
  // O AbortController cancela a requisição anterior se o usuário continuar digitando.
  useEffect(() => {
    if (!checkIn || !checkOut || !netAmountReceived) {
      setPreview(null);
      return;
    }
    const netAmount = Number(netAmountReceived.replace(",", "."));
    const cleaning = Number((cleaningFee || "0").replace(",", "."));
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch("/api/seasonal-rentals/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkIn, checkOut, netAmountReceived: netAmount, cleaningFee: cleaning, extrasTotal }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) {
            setPreviewError(data.error ?? "Erro ao calcular.");
            setPreview(null);
            return;
          }
          setPreviewError(null);
          setPreview(data);
          // Só preenche automaticamente com o valor sugerido se o usuário ainda
          // não editou esse campo manualmente (ver `cleaningFeeTouched` acima).
          if (!cleaningFeeTouched) setCleaningFee(String(data.suggestedCleaningFee));
        })
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkIn, checkOut, netAmountReceived, cleaningFee, extrasTotal]);

  /** Adiciona uma linha vazia de gasto extra ao formulário. */
  function addExpense() {
    setExpenses((prev) => [...prev, { description: "", amount: "" }]);
  }

  /** Atualiza um campo (descrição ou valor) de uma linha de gasto extra específica. */
  function updateExpense(index: number, patch: Partial<ExpenseRow>) {
    setExpenses((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  /** Remove uma linha de gasto extra do formulário. */
  function removeExpense(index: number) {
    setExpenses((prev) => prev.filter((_, i) => i !== index));
  }

  /** Envia o formulário para POST /api/seasonal-rentals, criando o registro do aluguel. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkIn || !checkOut || !netAmountReceived) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/seasonal-rentals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          checkIn,
          checkOut,
          netAmountReceived: Number(netAmountReceived.replace(",", ".")),
          cleaningFee: Number((cleaningFee || "0").replace(",", ".")),
          expenses: expenses
            .filter((ex) => ex.description && ex.amount)
            .map((ex) => ({ description: ex.description, amount: Number(ex.amount.replace(",", ".")) })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? JSON.stringify(data.error) : "Erro ao salvar o aluguel.");
        return;
      }
      onCreated();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Novo registro de aluguel</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">Aluguel</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as typeof platform)}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="AIRBNB">Airbnb</option>
              <option value="BOOKING">Booking</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Check-in</label>
            <input
              type="date"
              required
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Check-out</label>
            <input
              type="date"
              required
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">Valor líquido recebido em conta (R$)</label>
            <input
              type="text"
              required
              inputMode="decimal"
              value={netAmountReceived}
              onChange={(e) => setNetAmountReceived(e.target.value)}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400">10% do David</label>
            <input
              type="text"
              disabled
              value={preview ? formatBRL(preview.davidTenPercent) : "—"}
              className="border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1 col-span-2">
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Valor da limpeza (R$) {!cleaningFeeTouched && preview ? "— sugerido pela tabela" : ""}
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={cleaningFee}
              onChange={(e) => {
                setCleaningFeeTouched(true);
                setCleaningFee(e.target.value);
              }}
              className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-500 dark:text-slate-400">Gastos extras (opcional)</label>
            <button type="button" onClick={addExpense} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              + adicionar gasto
            </button>
          </div>
          {expenses.map((ex, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                placeholder="ex: gás, produtos de limpeza"
                value={ex.description}
                onChange={(e) => updateExpense(i, { description: e.target.value })}
                className="flex-1 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={ex.amount}
                onChange={(e) => updateExpense(i, { amount: e.target.value })}
                className="w-24 border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => removeExpense(i)}
                className="text-slate-400 hover:text-red-500 text-xs px-1"
              >
                remover
              </button>
            </div>
          ))}
        </div>

        {previewError && <p className="text-sm text-red-600 dark:text-red-400">{previewError}</p>}

        {preview && (
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm space-y-1">
            <p className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Noites</span>
              <span className="text-slate-900 dark:text-slate-100">{preview.nights}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Valor de tabela para as datas</span>
              <span className="text-slate-900 dark:text-slate-100">{formatBRL(preview.tableValue)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Valor extra de tabela</span>
              <span className="text-slate-900 dark:text-slate-100">{formatBRL(preview.extraTableValue)}</span>
            </p>
            <p className="flex justify-between font-medium pt-1 border-t border-slate-200 dark:border-slate-700">
              <span className="text-indigo-700 dark:text-indigo-400">Total David</span>
              <span className="text-indigo-700 dark:text-indigo-400">{formatBRL(preview.totalDavid)}</span>
            </p>
            <p className="flex justify-between font-medium">
              <span className="text-emerald-700 dark:text-emerald-400">Valor líquido para distribuição</span>
              <span className="text-emerald-700 dark:text-emerald-400">{formatBRL(preview.netForDistribution)}</span>
            </p>
          </div>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting || !preview}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Salvando..." : "Salvar registro"}
          </button>
        </div>
      </form>
    </div>
  );
}
