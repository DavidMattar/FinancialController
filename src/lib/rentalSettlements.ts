import { prisma } from "./prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "./dateOnly";
import { computeRental } from "./rentalCalc";

/**
 * Existem DUAS trilhas de repasse independentes para o mesmo conjunto de
 * aluguéis, cada uma travada separadamente (ver `SeasonalRental.davidSettlementId`
 * e `.familiaSettlementId` no schema do Prisma):
 * - "DAVID": quanto o David já recebeu (10% + eventual metade do valor extra
 *   de tabela) em um período.
 * - "FAMILIA": quanto falta dividir entre a família a partir do "valor
 *   líquido para distribuição" de cada aluguel.
 * Fechar um repasse David não fecha o repasse Família do mesmo aluguel (e
 * vice-versa) — por isso os dois IDs de settlement são campos separados.
 */
export type SettlementType = "DAVID" | "FAMILIA";

/**
 * Busca todos os aluguéis do período informado que AINDA NÃO tiveram esse
 * tipo de repasse gerado (ou seja, cujo `davidSettlementId`/`familiaSettlementId`
 * ainda está nulo), e recalcula os valores de cada um na hora — nada fica
 * armazenado, então uma correção em um aluguel antigo se reflete
 * automaticamente aqui.
 */
async function findUnsettledRentals(type: SettlementType, from: string, to: string) {
  const rentals = await prisma.seasonalRental.findMany({
    where: {
      ...(type === "DAVID" ? { davidSettlementId: null } : { familiaSettlementId: null }),
      checkOut: { gte: parseLocalDate(from), lte: parseLocalDateEndOfDay(to) },
    },
    include: { expenses: true },
    orderBy: { checkOut: "asc" },
  });

  return rentals.map((rental) => {
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
      expenses,
      computed,
    };
  });
}

/**
 * Calcula quanto seria o repasse do período, SEM gravar nada no banco — usado
 * pela tela de "Fechar repasse" para mostrar ao usuário o valor antes de ele
 * confirmar. Para o tipo FAMILIA, soma o "valor líquido para distribuição" de
 * todos os aluguéis do período e divide por 2 (o repasse familiar é
 * compartilhado entre duas partes).
 */
export async function previewSettlement(type: SettlementType, from: string, to: string) {
  const rentals = await findUnsettledRentals(type, from, to);
  const totalAmount =
    type === "DAVID"
      ? rentals.reduce((sum, r) => sum + r.computed.totalDavid, 0)
      : rentals.reduce((sum, r) => sum + r.computed.netForDistribution, 0) / 2;
  return { totalAmount, rentalCount: rentals.length, rentals };
}

/**
 * Confirma o repasse: cria o registro de `RentalSettlement` e trava todos os
 * aluguéis envolvidos (marcando `davidSettlementId`/`familiaSettlementId`)
 * para que não entrem em um repasse futuro do mesmo tipo. Retorna `null` se
 * não havia nenhum aluguel pendente no período (nada a fazer).
 *
 * IMPORTANTE: por decisão explícita do usuário, uma vez gerado o repasse ele
 * fica travado — não existe (e não deve ser criada) uma função para
 * "cancelar" ou desfazer um repasse já confirmado.
 */
export async function createSettlement(type: SettlementType, periodFrom: string, periodTo: string) {
  const { totalAmount, rentalCount, rentals } = await previewSettlement(type, periodFrom, periodTo);
  if (rentalCount === 0) return null;

  const settlement = await prisma.rentalSettlement.create({
    data: {
      type,
      periodFrom: parseLocalDate(periodFrom),
      periodTo: parseLocalDateEndOfDay(periodTo),
      totalAmount,
      rentalCount,
    },
  });

  await prisma.seasonalRental.updateMany({
    where: { id: { in: rentals.map((r) => r.id) } },
    data: type === "DAVID" ? { davidSettlementId: settlement.id } : { familiaSettlementId: settlement.id },
  });

  return settlement;
}
