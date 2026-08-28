import { computeRental } from "./rentalCalc";

/** Rótulo de exibição de cada plataforma de aluguel de temporada. */
export const RENTAL_PLATFORM_LABEL: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking" };

interface SeasonalRentalRecord {
  id: string;
  platform: string;
  checkIn: Date;
  checkOut: Date;
  netAmountReceived: unknown;
  cleaningFee: unknown;
  notes: string | null;
  createdAt: Date;
  davidSettlementId: string | null;
  familiaSettlementId: string | null;
  transactionId: string | null;
  expenses: { id: string; description: string; amount: unknown }[];
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
  const computed = computeRental({
    checkIn: rental.checkIn,
    checkOut: rental.checkOut,
    netAmountReceived,
    cleaningFee,
    extrasTotal,
  });
  return {
    id: rental.id,
    platform: rental.platform,
    checkIn: rental.checkIn,
    checkOut: rental.checkOut,
    netAmountReceived,
    cleaningFee,
    notes: rental.notes,
    createdAt: rental.createdAt,
    isDavidSettled: rental.davidSettlementId !== null,
    isFamiliaSettled: rental.familiaSettlementId !== null,
    expenses,
    computed,
  };
}
