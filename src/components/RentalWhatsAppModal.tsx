"use client";

// Modal que gera um relatório de texto formatado para ser enviado por
// WhatsApp, referente a UM único aluguel (não um relatório geral — cada
// aluguel tem seu próprio botão/relatório). Usa a convenção do WhatsApp de
// *texto entre asteriscos* para negrito, e inclui todos os detalhes do
// aluguel, inclusive os itens de gastos extras (ver src/lib/whatsappReport.ts).

import { useState } from "react";
import { buildSingleRentalWhatsAppReport } from "@/lib/whatsappReport";

interface RentalExpense {
  description: string;
  amount: number;
}

interface RentalForReport {
  platform: "AIRBNB" | "BOOKING";
  checkIn: string;
  checkOut: string;
  netAmountReceived: number;
  cleaningFee: number;
  expenses: RentalExpense[];
  computed: {
    nights: number;
    tableValue: number;
    davidTenPercent: number;
    extraTableValue: number;
    totalDavid: number;
    netForDistribution: number;
  };
}

interface Props {
  rental: RentalForReport;
  onClose: () => void;
}

export default function RentalWhatsAppModal({ rental, onClose }: Props) {
  // Controla o texto exibido no botão ("Copiar mensagem" / "Copiado!") por 2 segundos.
  const [copied, setCopied] = useState(false);
  // Texto final já formatado (com *negrito* estilo WhatsApp) pronto para copiar.
  const reportText = buildSingleRentalWhatsAppReport(rental);

  /** Copia o relatório para a área de transferência e mostra a confirmação por 2s. */
  async function handleCopy() {
    await navigator.clipboard.writeText(reportText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg space-y-4"
      >
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Relatório para WhatsApp</h2>

        <textarea
          readOnly
          value={reportText}
          rows={14}
          className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-2 text-xs font-mono"
        />
        <button
          type="button"
          onClick={handleCopy}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
        >
          {copied ? "Copiado!" : "Copiar mensagem"}
        </button>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
