"use client";

/**
 * Página "/importar-fatura" — ponto de entrada para os dois fluxos de
 * importação em massa do app: fatura de cartão de crédito em PDF
 * (`InvoiceImportPanel`) e nota fiscal de supermercado/NFC-e
 * (`ReceiptImportPanel`). Uma aba simples alterna entre os dois painéis;
 * cada painel implementa seu próprio fluxo de "pré-visualizar e depois
 * confirmar" antes de gravar qualquer coisa no banco.
 */
import { useState } from "react";
import InvoiceImportPanel from "@/components/InvoiceImportPanel";
import ReceiptImportPanel from "@/components/ReceiptImportPanel";

type Tab = "invoice" | "receipt";

export default function ImportarFaturaPage() {
  const [tab, setTab] = useState<Tab>("invoice");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Importar</h1>

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setTab("invoice")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "invoice"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          Fatura de Cartão
        </button>
        <button
          type="button"
          onClick={() => setTab("receipt")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "receipt"
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          Nota Fiscal de Supermercado
        </button>
      </div>

      {tab === "invoice" ? <InvoiceImportPanel /> : <ReceiptImportPanel />}
    </div>
  );
}
