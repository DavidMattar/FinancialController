"use client";

// Modal (janela sobreposta) para registrar OU editar um aluguel de temporada
// (Airbnb ou Booking). Enquanto o usuário digita, o formulário consulta a API
// de preview para mostrar em tempo real os valores calculados: 10% do David
// (mínimo garantido — nunca cai abaixo disso mesmo se o aluguel saiu mais
// barato que a tabela), o valor de tabela, e o valor líquido para distribuição
// entre a família. Ao criar, o backend também cria automaticamente uma
// transação de receita (Total David) na categoria "Aluguel Rancho"; ao editar
// (mesmo um aluguel já com repasse fechado), essa mesma transação é
// atualizada com o novo valor — o repasse já fechado em si não muda.
//
// O campo "Nota sobre a estadia" é uma observação livre daquele aluguel
// (`SeasonalRental.notes`): aparece na lista de aluguéis e aqui, mas NÃO entra
// no relatório de WhatsApp — é anotação interna, por decisão do usuário.
//
// O bloco "Valores das diárias" lista noite por noite a tarifa que a tabela de
// preços (src/lib/rentalPriceTable.ts) aplica e permite sobrescrever cada uma
// SÓ NESTE aluguel: o valor digitado é salvo em
// `SeasonalRental.nightRateOverrides` e muda o cálculo apenas deste registro —
// a tabela de preços global e todos os outros aluguéis continuam intactos.

import { useEffect, useState } from "react";
import { formatBRL, formatDate } from "@/lib/format";

interface ExpenseRow {
  description: string;
  amount: string;
}

/** Dados mínimos de um aluguel existente necessários para pré-preencher o formulário de edição. */
interface RentalToEdit {
  id: string;
  platform: "AIRBNB" | "BOOKING";
  checkIn: string;
  checkOut: string;
  netAmountReceived: number;
  cleaningFee: number;
  /** Observação livre sobre a estadia — `SeasonalRental.notes`. */
  notes?: string | null;
  isDavidSettled: boolean;
  isFamiliaSettled: boolean;
  isLimpezaSettled: boolean;
  expenses: { description: string; amount: number }[];
  /** Diárias já customizadas deste aluguel: { "YYYY-MM-DD": valor }. */
  nightRateOverrides?: Record<string, number> | null;
}

/** Uma noite da estadia, como devolvida em `computed.nightRates` pela API. */
interface NightRate {
  /** Data da noite em ISO (serializada pelo `NextResponse.json`). */
  date: string;
  /** Chave "YYYY-MM-DD" da noite — é a chave usada no mapa de diárias customizadas. */
  key: string;
  /** Quanto a tabela de preços cobra por esta noite (não muda com a customização). */
  tableRate: number;
  /** Quanto está sendo usado no cálculo (o valor customizado, se houver). */
  rate: number;
  isOverridden: boolean;
  kind: "HOLIDAY" | "HIGH_SEASON" | "LOW_SEASON";
  isWeekend: boolean;
}

/** Formato devolvido por POST /api/seasonal-rentals/preview — os mesmos números que serão salvos ao confirmar. */
interface Preview {
  nights: number;
  tableValue: number;
  /** Detalhamento por noite, base da lista editável de diárias. */
  nightRates: NightRate[];
  hasCustomNightRates: boolean;
  davidTenPercent: number;
  extrasTotal: number;
  extraTableValue: number;
  totalDavid: number;
  netForDistribution: number;
  /** Valor de limpeza sugerido pela API (hoje um valor fixo de R$180, mas editável pelo usuário). */
  suggestedCleaningFee: number;
}

interface Props {
  /** Quando informado, o modal abre em modo de edição, pré-preenchido com estes dados. */
  rental?: RentalToEdit;
  onClose: () => void;
  /** Chamado depois que o aluguel é criado ou salvo com sucesso, para o componente pai recarregar a lista. */
  onSaved: () => void;
}

/** Rótulo curto da regra da tabela que definiu a tarifa de cada noite. */
const NIGHT_KIND_LABEL: Record<NightRate["kind"], string> = {
  HOLIDAY: "Feriado",
  HIGH_SEASON: "Alta temporada",
  LOW_SEASON: "Baixa temporada",
};

/** Dia da semana abreviado (ex: "sex.") da noite, para ajudar a identificar a linha. */
function weekdayLabel(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(new Date(iso));
}

export default function SeasonalRentalModal({ rental, onClose, onSaved }: Props) {
  const isEditing = rental !== undefined;
  const [platform, setPlatform] = useState<"AIRBNB" | "BOOKING">(rental?.platform ?? "AIRBNB");
  // checkIn/checkOut chegam da API como string ISO ("YYYY-MM-DDT...") — o
  // input type="date" espera só os 10 primeiros caracteres ("YYYY-MM-DD").
  const [checkIn, setCheckIn] = useState(rental ? rental.checkIn.slice(0, 10) : "");
  const [checkOut, setCheckOut] = useState(rental ? rental.checkOut.slice(0, 10) : "");
  const [netAmountReceived, setNetAmountReceived] = useState(rental ? String(rental.netAmountReceived) : "");
  const [cleaningFee, setCleaningFee] = useState(rental ? String(rental.cleaningFee) : "");
  // Vira true assim que o usuário edita manualmente o campo de limpeza — a
  // partir daí o valor sugerido pela API deixa de sobrescrever o que foi digitado.
  // Ao editar um aluguel existente já começa true, para não sobrescrever o
  // valor de limpeza já salvo com a sugestão padrão da tabela.
  const [cleaningFeeTouched, setCleaningFeeTouched] = useState(isEditing);
  const [notes, setNotes] = useState(rental?.notes ?? "");
  const [expenses, setExpenses] = useState<ExpenseRow[]>(
    rental ? rental.expenses.map((e) => ({ description: e.description, amount: String(e.amount) })) : []
  );
  // Diárias customizadas em edição, guardadas como STRING (o que está digitado
  // no input) para o usuário poder usar vírgula decimal e apagar o campo. A
  // conversão para número acontece em `numericNightRateOverrides`, abaixo.
  const [nightRateOverrides, setNightRateOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(rental?.nightRateOverrides ?? {}).map(([k, v]) => [k, String(v)]))
  );
  // A lista de diárias já abre expandida quando o aluguel sendo editado tem
  // alguma diária customizada, para o valor customizado não ficar escondido.
  const [showNightRates, setShowNightRates] = useState(
    Object.keys(rental?.nightRateOverrides ?? {}).length > 0
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Soma dos gastos extras digitados, aceitando tanto vírgula quanto ponto decimal.
  const extrasTotal = expenses.reduce((sum, e) => sum + (Number(e.amount.replace(",", ".")) || 0), 0);

  // Só as diárias com valor numérico válido viram customização de verdade — um
  // campo apagado pelo usuário faz aquela noite voltar a seguir a tabela.
  const numericNightRateOverrides: Record<string, number> = {};
  for (const [key, raw] of Object.entries(nightRateOverrides)) {
    const value = Number(raw.replace(",", "."));
    if (raw.trim() !== "" && Number.isFinite(value) && value >= 0) numericNightRateOverrides[key] = value;
  }
  // Chave estável (ordenada) do mapa de diárias, para servir de dependência do
  // useEffect sem disparar a cada re-render só por identidade de objeto.
  const nightRateOverridesKey = JSON.stringify(
    Object.entries(numericNightRateOverrides).sort(([a], [b]) => a.localeCompare(b))
  );
  const overriddenCount = Object.keys(numericNightRateOverrides).length;

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
        body: JSON.stringify({
          checkIn,
          checkOut,
          netAmountReceived: netAmount,
          cleaningFee: cleaning,
          extrasTotal,
          nightRateOverrides: numericNightRateOverrides,
        }),
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
  }, [checkIn, checkOut, netAmountReceived, cleaningFee, extrasTotal, nightRateOverridesKey]);

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

  /**
   * Define (ou remove) o valor customizado da diária de uma noite. Apagar o
   * campo remove a customização daquela noite, fazendo ela voltar a seguir a
   * tabela de preços.
   */
  function updateNightRate(key: string, value: string) {
    setNightRateOverrides((prev) => {
      const next = { ...prev };
      if (value.trim() === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  /** Faz uma noite voltar a usar o valor da tabela de preços. */
  function resetNightRate(key: string) {
    setNightRateOverrides((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Descarta todas as diárias customizadas deste aluguel (volta 100% para a tabela). */
  function resetAllNightRates() {
    setNightRateOverrides({});
  }

  /** Envia o formulário para POST (criar) ou PUT (editar) /api/seasonal-rentals. */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!checkIn || !checkOut || !netAmountReceived) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isEditing ? `/api/seasonal-rentals/${rental.id}` : "/api/seasonal-rentals", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          checkIn,
          checkOut,
          netAmountReceived: Number(netAmountReceived.replace(",", ".")),
          cleaningFee: Number((cleaningFee || "0").replace(",", ".")),
          // Nota em branco é gravada como null (e não como ""), para "sem nota"
          // ser um único valor no banco.
          notes: notes.trim() === "" ? null : notes.trim(),
          // O mapa vai inteiro: o servidor substitui as diárias customizadas por
          // completo (mapa vazio = todas as noites voltam para a tabela).
          nightRateOverrides: numericNightRateOverrides,
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
      onSaved();
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
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {isEditing ? "Editar aluguel" : "Novo registro de aluguel"}
        </h2>

        {isEditing && (rental.isDavidSettled || rental.isFamiliaSettled || rental.isLimpezaSettled) && (
          <p className="text-xs bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 rounded-md px-2 py-1.5">
            Este aluguel já teve repasse gerado. O valor do repasse já fechado não muda, mas o Total David
            será recalculado e a transação de crédito vinculada será atualizada com o novo valor.
          </p>
        )}

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

        {/* Valores das diárias — só deste aluguel. Cada noite começa com o valor
            da tabela de preços; alterar o campo cria um valor customizado que
            muda o cálculo APENAS deste registro. */}
        {preview && preview.nightRates.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowNightRates((v) => !v)}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
              >
                {showNightRates ? "▾" : "▸"} Valores das diárias ({preview.nightRates.length} noites)
                {overriddenCount > 0 && (
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                    {overriddenCount} customizada{overriddenCount > 1 ? "s" : ""}
                  </span>
                )}
              </button>
              {overriddenCount > 0 && (
                <button
                  type="button"
                  onClick={resetAllNightRates}
                  className="text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  restaurar tabela em todas
                </button>
              )}
            </div>

            {showNightRates && (
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-slate-100 dark:divide-slate-700">
                <p className="text-[11px] text-slate-500 dark:text-slate-400 px-2.5 py-2">
                  A diária de cada noite começa com o valor da tabela de preços. Alterar um valor aqui muda o
                  cálculo <strong>somente deste aluguel</strong> — a tabela e os outros aluguéis não são
                  afetados.
                </p>
                {preview.nightRates.map((night) => (
                  <div key={night.key} className="flex items-center gap-2 px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-900 dark:text-slate-100 truncate">
                        {formatDate(night.date)}{" "}
                        <span className="text-slate-400 dark:text-slate-500">({weekdayLabel(night.date)})</span>
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {NIGHT_KIND_LABEL[night.kind]}
                        {night.kind !== "HOLIDAY" && (night.isWeekend ? " · fim de semana" : " · dia de semana")}
                        {night.isOverridden && ` · tabela: ${formatBRL(night.tableRate)}`}
                      </p>
                    </div>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Valor da diária de ${formatDate(night.date)}`}
                      value={nightRateOverrides[night.key] ?? String(night.tableRate)}
                      onChange={(e) => updateNightRate(night.key, e.target.value)}
                      className={`w-24 shrink-0 border rounded-md px-2 py-1 text-sm text-right dark:text-slate-100 ${
                        night.isOverridden
                          ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40"
                          : "border-slate-200 dark:border-slate-600 dark:bg-slate-900"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => resetNightRate(night.key)}
                      disabled={!night.isOverridden}
                      className="w-16 shrink-0 text-[11px] text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-0"
                    >
                      restaurar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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

        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 dark:text-slate-400">Nota sobre a estadia (opcional)</label>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="ex: hóspede chegou tarde, pediu check-out estendido, quebrou uma taça"
            className="border border-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-md px-2 py-1.5 text-sm resize-y"
          />
        </div>

        {previewError && <p className="text-sm text-red-600 dark:text-red-400">{previewError}</p>}

        {preview && (
          <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-sm space-y-1">
            <p className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Noites</span>
              <span className="text-slate-900 dark:text-slate-100">{preview.nights}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">
                Valor de tabela para as datas
                {preview.hasCustomNightRates && " (com diárias customizadas)"}
              </span>
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
            {submitting ? "Salvando..." : isEditing ? "Salvar alterações" : "Salvar registro"}
          </button>
        </div>
      </form>
    </div>
  );
}
