"use client";

// Modal para "fechar o repasse" de um período de aluguéis de temporada.
// Existem três tipos de repasse, completamente independentes entre si:
// - DAVID: soma o "Total David" (o que ele recebe) de cada aluguel ainda não
//   fechado nesse tipo, dentro do período escolhido.
// - FAMILIA: soma o "Valor líquido para distribuição" de cada aluguel ainda
//   não fechado nesse tipo, no período, e divide o total por 2.
// - LIMPEZA: soma o "Valor da limpeza" de cada aluguel ainda não fechado nesse
//   tipo, no período, sem dividir — é o que sai para pagar quem limpa.
// Gerar o repasse é uma ação permanente: os aluguéis incluídos ficam
// marcados como fechados para aquele tipo e não há como desfazer pela
// interface (decisão explícita do usuário — ver SeasonalRentalsSection.tsx).

import { useEffect, useState } from "react";
import DateRangePicker from "./DateRangePicker";
import { currentMonthRange, type DateRange } from "@/lib/dateRanges";
import { formatBRL, formatDate } from "@/lib/format";

type SettlementType = "DAVID" | "FAMILIA" | "LIMPEZA";

interface PreviewRental {
  id: string;
  platform: "AIRBNB" | "BOOKING";
  checkIn: string;
  checkOut: string;
  /** Base da trilha LIMPEZA — o valor de limpeza informado naquele aluguel. */
  cleaningFee: number;
  computed: { totalDavid: number; netForDistribution: number };
}

interface Preview {
  totalAmount: number;
  rentalCount: number;
  rentals: PreviewRental[];
}

interface Props {
  onClose: () => void;
  onGenerated: () => void;
}

const PLATFORM_LABEL: Record<PreviewRental["platform"], string> = { AIRBNB: "Airbnb", BOOKING: "Booking" };

/** Ordem das abas do modal — uma por trilha de repasse. */
const SETTLEMENT_TYPES: readonly SettlementType[] = ["DAVID", "FAMILIA", "LIMPEZA"];

const SETTLEMENT_LABEL: Record<SettlementType, string> = {
  DAVID: "David",
  FAMILIA: "Família",
  LIMPEZA: "Limpeza",
};

/** Explicação de qual valor cada trilha soma, exibida abaixo das abas. */
const SETTLEMENT_HELP: Record<SettlementType, string> = {
  DAVID:
    'Soma o "Total David" de todos os aluguéis (desse tipo, ainda não fechados) cuja saída está no período escolhido.',
  FAMILIA:
    'Soma o "Valor líquido para distribuição" de todos os aluguéis (desse tipo, ainda não fechados) no período, e divide o total por 2.',
  LIMPEZA:
    'Soma o "Valor da limpeza" de todos os aluguéis (desse tipo, ainda não fechados) no período, sem dividir — é o valor que sai para pagar quem limpa.',
};

export default function SettlementModal({ onClose, onGenerated }: Props) {
  const [type, setType] = useState<SettlementType>("DAVID");
  const [range, setRange] = useState<DateRange>(currentMonthRange());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ totalAmount: number } | null>(null);

  // Recarrega o preview sempre que o tipo (David/Família) ou o período mudam.
  useEffect(() => {
    setLoading(true);
    setResult(null);
    setError(null);
    fetch(`/api/rental-settlements/preview?type=${type}&from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((data) => {
        setPreview(data);
        setLoading(false);
      });
  }, [type, range]);

  /** Confirma a geração do repasse: cria o registro definitivo e marca os aluguéis envolvidos como fechados. */
  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/rental-settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, periodFrom: range.from, periodTo: range.to }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ? JSON.stringify(data.error) : "Erro ao gerar o registro.");
        return;
      }
      setResult(data);
      onGenerated();
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Valor exibido por aluguel na lista de preview, conforme a trilha escolhida:
   * Total David, valor da limpeza ou valor líquido para distribuição. Espelha
   * o `rentalShare` de src/lib/rentalSettlements.ts — se um dos dois mudar, o
   * outro precisa mudar junto, senão a lista não bate com o total gerado.
   */
  const perRentalValue = (r: PreviewRental) =>
    type === "DAVID" ? r.computed.totalDavid : type === "LIMPEZA" ? r.cleaningFee : r.computed.netForDistribution;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Fechar repasse do período</h2>

        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {SETTLEMENT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                type === t
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              }`}
            >
              {SETTLEMENT_LABEL[t]}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">{SETTLEMENT_HELP[type]}</p>

        {result ? (
          <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-sm text-emerald-800 dark:text-emerald-300">
            Registro gerado ({SETTLEMENT_LABEL[type]}): {formatBRL(result.totalAmount)} referente ao
            período {formatDate(range.from)} – {formatDate(range.to)}.
          </div>
        ) : (
          <>
            <DateRangePicker value={range} onChange={setRange} />

            {loading ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
            ) : !preview || preview.rentalCount === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Nenhum aluguel pendente de fechamento nesse período.
              </p>
            ) : (
              <>
                <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-700 max-h-52 overflow-y-auto">
                  {preview.rentals.map((r) => (
                    <li key={r.id} className="flex justify-between py-1.5">
                      <span className="text-slate-700 dark:text-slate-300">
                        {PLATFORM_LABEL[r.platform]} — {formatDate(r.checkIn)} a {formatDate(r.checkOut)}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {formatBRL(perRentalValue(r))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="flex justify-between text-sm font-semibold pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-indigo-700 dark:text-indigo-400">
                    {/* O plural de "aluguel" é "aluguéis" (troca o "l"), não
                        "aluguel" + sufixo — por isso a palavra inteira é
                        escolhida de uma vez em vez de concatenada. */}
                    Total {type === "FAMILIA" ? "(soma ÷ 2) " : ""}({preview.rentalCount}{" "}
                    {preview.rentalCount === 1 ? "aluguel" : "aluguéis"})
                  </span>
                  <span className="text-indigo-700 dark:text-indigo-400">{formatBRL(preview.totalAmount)}</span>
                </p>
              </>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {result ? "Fechar" : "Cancelar"}
          </button>
          {!result && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={submitting || !preview || preview.rentalCount === 0}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? "Gerando..." : "Gerar registro"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
