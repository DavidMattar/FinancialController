import { computeRental } from "./rentalCalc";
import type { NightRateOverrides } from "./rentalPriceTable";

/** Rótulo de exibição de cada plataforma de aluguel de temporada. */
export const RENTAL_PLATFORM_LABEL: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking" };

/**
 * Nome da categoria em que entra a receita auto-criada de cada aluguel de
 * temporada (o "Total David"). A categoria é procurada por NOME porque a
 * ligação entre aluguel e ledger é uma soft reference de propósito (ver o
 * model `SeasonalRental`) — não existe FK para uma categoria fixa.
 *
 * Está aqui, e não escrito à mão em cada lugar, porque duas telas dependem do
 * MESMO nome: a rota que cria a receita e a tela /receitas, que usa esse nome
 * para NÃO deixar editar nem excluir essas linhas (elas pertencem ao aluguel,
 * e quem manda nelas é o modal de aluguel). Se os dois divergissem, a receita
 * de aluguel voltaria a ser editável no ledger e sairia do valor do aluguel
 * que a gerou.
 */
export const RENTAL_INCOME_CATEGORY_NAME = "Aluguel Rancho";

interface SeasonalRentalRecord {
  id: string;
  platform: string;
  checkIn: Date;
  checkOut: Date;
  netAmountReceived: unknown;
  cleaningFee: unknown;
  notes: string | null;
  /** Json livre do banco — ver `readNightRateOverrides`. */
  nightRateOverrides?: unknown;
  createdAt: Date;
  davidSettlementId: string | null;
  familiaSettlementId: string | null;
  limpezaSettlementId: string | null;
  transactionId: string | null;
  expenses: { id: string; description: string; amount: unknown }[];
}

/**
 * Lê o campo Json `SeasonalRental.nightRateOverrides` como um mapa
 * "YYYY-MM-DD" -> valor da diária. Como é um Json livre (pode ser null, e nos
 * registros criados antes desta feature sempre é), qualquer coisa fora do
 * formato esperado é tratada como "sem diária customizada" em vez de quebrar
 * o cálculo do aluguel.
 */
export function readNightRateOverrides(value: unknown): NightRateOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: NightRateOverrides = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount >= 0) result[key] = amount;
  }
  return result;
}

/**
 * Converte um `SeasonalRental` vindo do Prisma (com `Decimal`) para um objeto
 * serializável em JSON, já incluindo os valores derivados (`computed`) —
 * usado tanto na listagem quanto após criar/editar um registro, para manter
 * a resposta da API sempre no mesmo formato.
 */
export function serializeRentalWithComputed(rental: SeasonalRentalRecord) {
  const netAmountReceived = Number(rental.netAmountReceived);
  const cleaningFee = Number(rental.cleaningFee);
  const expenses = rental.expenses.map((e) => ({ ...e, amount: Number(e.amount) }));
  const extrasTotal = expenses.reduce((sum, e) => sum + e.amount, 0);
  const nightRateOverrides = readNightRateOverrides(rental.nightRateOverrides);
  const computed = computeRental({
    checkIn: rental.checkIn,
    checkOut: rental.checkOut,
    netAmountReceived,
    cleaningFee,
    extrasTotal,
    nightRateOverrides,
  });
  return {
    id: rental.id,
    platform: rental.platform,
    checkIn: rental.checkIn,
    checkOut: rental.checkOut,
    netAmountReceived,
    cleaningFee,
    notes: rental.notes,
    // Devolvido separado do `computed.nightRates` porque é exatamente o que o
    // formulário de edição precisa reenviar no PUT (só as noites customizadas).
    nightRateOverrides,
    createdAt: rental.createdAt,
    isDavidSettled: rental.davidSettlementId !== null,
    isFamiliaSettled: rental.familiaSettlementId !== null,
    isLimpezaSettled: rental.limpezaSettlementId !== null,
    expenses,
    computed,
  };
}
