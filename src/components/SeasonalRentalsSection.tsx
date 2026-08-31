"use client";

// Seção do dashboard que lista todos os aluguéis de temporada cadastrados
// (Airbnb/Booking), com os valores calculados de cada um (Total David e
// Valor líquido para distribuição), botões para registrar um novo aluguel,
// gerar o repasse do período (David, Família ou Limpeza) e gerar o relatório
// de WhatsApp — este último é sempre por aluguel individual, não um relatório
// geral, a pedido explícito do usuário.
//
// A nota de cada aluguel é uma observação livre sobre aquela estadia. Aparece
// aqui e no modal de edição, e NÃO entra no relatório de WhatsApp (decisão do
// usuário: é anotação interna, não informação para o destinatário).

import { useEffect, useState } from "react";
import CollapsibleSection from "./CollapsibleSection";
import SeasonalRentalModal from "./SeasonalRentalModal";
import SettlementModal from "./SettlementModal";
import RentalWhatsAppModal from "./RentalWhatsAppModal";
import ConfirmDialog from "./ConfirmDialog";
import { formatBRL, formatDate } from "@/lib/format";

interface RentalExpense {
  id: string;
  description: string;
  amount: number;
}

interface Rental {
  id: string;
  platform: "AIRBNB" | "BOOKING";
  checkIn: string;
  checkOut: string;
  netAmountReceived: number;
  cleaningFee: number;
  /** Observação livre sobre esta estadia (null/vazio = sem nota). */
  notes?: string | null;
  isDavidSettled: boolean;
  isFamiliaSettled: boolean;
  isLimpezaSettled: boolean;
  expenses: RentalExpense[];
  /** Diárias customizadas só deste aluguel: { "YYYY-MM-DD": valor }. Vazio = tudo pela tabela. */
  nightRateOverrides: Record<string, number>;
  computed: {
    nights: number;
    tableValue: number;
    /** true quando alguma noite deste aluguel usa diária customizada em vez da tabela. */
    hasCustomNightRates: boolean;
    davidTenPercent: number;
    extrasTotal: number;
    extraTableValue: number;
    totalDavid: number;
    netForDistribution: number;
  };
}

const PLATFORM_LABEL: Record<Rental["platform"], string> = {
  AIRBNB: "Airbnb",
  BOOKING: "Booking",
};

export default function SeasonalRentalsSection() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  // "new" abre o modal de criação; um Rental abre o modal já preenchido para
  // editar aquele aluguel específico; null mantém o modal fechado.
  const [modalTarget, setModalTarget] = useState<"new" | Rental | null>(null);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  // Guarda qual aluguel terá seu relatório de WhatsApp exibido (null = modal fechado).
  const [whatsAppRental, setWhatsAppRental] = useState<Rental | null>(null);
  // Guarda qual aluguel está pendente de confirmação de exclusão (null = nenhum).
  const [toDelete, setToDelete] = useState<Rental | null>(null);

  /** Busca a lista completa de aluguéis (já com os valores calculados) na API. */
  async function load() {
    setLoading(true);
    const res = await fetch("/api/seasonal-rentals");
    setRentals(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  /** Confirma a exclusão de um aluguel: remove o registro (e a receita gerada automaticamente) e recarrega a lista. */
  async function handleConfirmDelete() {
    // Guard de tipo: o diálogo só abre com um aluguel selecionado.
    /* v8 ignore next */
    if (!toDelete) return;
    await fetch(`/api/seasonal-rentals/${toDelete.id}`, { method: "DELETE" });
    setToDelete(null);
    load();
  }

  return (
    <>
      <CollapsibleSection
        title="Aluguéis de Temporada"
        subtitle="Airbnb e Booking — cálculo do repasse para o David e do valor líquido para distribuição"
        defaultOpen
        headerAction={
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowSettlementModal(true)}
              className="px-3 py-1.5 text-sm font-medium rounded-md border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950"
            >
              Fechar repasse do período
            </button>
            <button
              type="button"
              onClick={() => setModalTarget("new")}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              + Novo registro de aluguel
            </button>
          </div>
        }
      >
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : rentals.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum aluguel registrado ainda.</p>
        ) : (
          <div className="space-y-3">
            {rentals.map((r) => (
              <div
                key={r.id}
                className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {PLATFORM_LABEL[r.platform]}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 ml-2">
                      {formatDate(r.checkIn)} → {formatDate(r.checkOut)} ({r.computed.nights} noites)
                    </span>
                    {/* Uma vez que o repasse é gerado, o aluguel fica marcado como "fechado"
                        permanentemente para aquele tipo (David/Família) — decisão explícita
                        do usuário: não existe opção de cancelar um repasse já feito. */}
                    {r.isDavidSettled && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                        ✓ David
                      </span>
                    )}
                    {r.isFamiliaSettled && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                        ✓ Família
                      </span>
                    )}
                    {r.isLimpezaSettled && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300">
                        ✓ Limpeza
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Botão de relatório WhatsApp por aluguel individual (não existe um botão
                        de relatório geral — cada aluguel tem o seu próprio). */}
                    <button
                      type="button"
                      onClick={() => setWhatsAppRental(r)}
                      className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      WhatsApp
                    </button>
                    {/* Edita somente este aluguel — inclusive se já tiver repasse (David
                        e/ou Família) fechado; ver aviso e lógica no próprio modal. */}
                    <button
                      type="button"
                      onClick={() => setModalTarget(r)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setToDelete(r)}
                      className="text-xs text-slate-400 hover:text-red-500"
                    >
                      excluir
                    </button>
                  </div>
                </div>

                {/* Nota da estadia. `whitespace-pre-line` porque o usuário
                    digita em um textarea e as quebras de linha dele fazem
                    parte da observação. */}
                {r.notes && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700 rounded-md px-2 py-1.5">
                    {r.notes}
                  </p>
                )}

                {r.expenses.length > 0 && (
                  <ul className="text-xs text-slate-500 dark:text-slate-400 pl-3 list-disc">
                    {r.expenses.map((e) => (
                      <li key={e.id}>
                        {e.description}: {formatBRL(e.amount)}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs pt-1 border-t border-slate-100 dark:border-slate-700">
                  <p className="flex justify-between sm:flex-col sm:justify-start">
                    <span className="text-slate-500 dark:text-slate-400">Recebido</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">
                      {formatBRL(r.netAmountReceived)}
                    </span>
                  </p>
                  <p className="flex justify-between sm:flex-col sm:justify-start">
                    <span className="text-slate-500 dark:text-slate-400">Limpeza</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">
                      {formatBRL(r.cleaningFee)}
                    </span>
                  </p>
                  <p className="flex justify-between sm:flex-col sm:justify-start">
                    <span className="text-slate-500 dark:text-slate-400">
                      Valor de tabela
                      {/* Aviso de que este aluguel tem diária(s) customizada(s) — sem isso
                          o valor pareceria divergir da tabela de preços sem explicação. */}
                      {r.computed.hasCustomNightRates && (
                        <span
                          title="Este aluguel tem diárias customizadas (editáveis no botão 'editar')"
                          className="ml-1 text-amber-600 dark:text-amber-400"
                        >
                          ✎
                        </span>
                      )}
                    </span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">
                      {formatBRL(r.computed.tableValue)}
                    </span>
                  </p>
                  <p className="flex justify-between sm:flex-col sm:justify-start">
                    <span className="text-slate-500 dark:text-slate-400">Valor extra de tabela</span>
                    <span className="text-slate-900 dark:text-slate-100 font-medium">
                      {formatBRL(r.computed.extraTableValue)}
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-4 pt-1 border-t border-slate-100 dark:border-slate-700">
                  <p className="flex items-center gap-1.5">
                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">Total David:</span>
                    <span className="text-indigo-700 dark:text-indigo-300 font-semibold">
                      {formatBRL(r.computed.totalDavid)}
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                      Valor líquido para distribuição:
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                      {formatBRL(r.computed.netForDistribution)}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {modalTarget && (
        <SeasonalRentalModal
          rental={modalTarget === "new" ? undefined : modalTarget}
          onClose={() => setModalTarget(null)}
          onSaved={() => {
            setModalTarget(null);
            load();
          }}
        />
      )}

      {showSettlementModal && (
        <SettlementModal
          onClose={() => setShowSettlementModal(false)}
          onGenerated={load}
        />
      )}

      {whatsAppRental && (
        <RentalWhatsAppModal rental={whatsAppRental} onClose={() => setWhatsAppRental(null)} />
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir registro de aluguel"
        message="Excluir este registro de aluguel de temporada? A receita gerada automaticamente para o David também será removida."
        confirmLabel="Excluir"
        onConfirm={handleConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </>
  );
}
