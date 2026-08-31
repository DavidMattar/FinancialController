import { prisma } from "./prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "./dateOnly";
import { computeRental } from "./rentalCalc";
import { readNightRateOverrides } from "./seasonalRentals";

/**
 * Existem TRÊS trilhas de repasse independentes para o mesmo conjunto de
 * aluguéis, cada uma travada separadamente (ver `SeasonalRental.davidSettlementId`,
 * `.familiaSettlementId` e `.limpezaSettlementId` no schema do Prisma):
 * - "DAVID": quanto o David já recebeu (10% + eventual metade do valor extra
 *   de tabela) em um período.
 * - "FAMILIA": quanto falta dividir entre a família a partir do "valor
 *   líquido para distribuição" de cada aluguel.
 * - "LIMPEZA": quanto sair para pagar a limpeza, somando o "valor da limpeza"
 *   de cada aluguel.
 * Fechar o repasse de uma trilha não fecha as outras para o mesmo aluguel —
 * por isso os três IDs de settlement são campos separados.
 */
export type SettlementType = "DAVID" | "FAMILIA" | "LIMPEZA";

/**
 * Coluna que "trava" o aluguel em cada trilha. Um mapa (em vez de um encadeado
 * de ternários espalhado pelo arquivo) para que acrescentar uma quarta trilha
 * seja uma linha aqui, e para que a chave usada no filtro do `findMany` e a
 * usada no `updateMany` do fechamento nunca possam divergir.
 */
const SETTLEMENT_FIELD = {
  DAVID: "davidSettlementId",
  FAMILIA: "familiaSettlementId",
  LIMPEZA: "limpezaSettlementId",
} as const satisfies Record<SettlementType, string>;

/**
 * Busca todos os aluguéis do período informado que AINDA NÃO tiveram esse
 * tipo de repasse gerado (ou seja, cuja coluna de settlement daquela trilha
 * ainda está nula), e recalcula os valores de cada um na hora — nada fica
 * armazenado, então uma correção em um aluguel antigo se reflete
 * automaticamente aqui.
 */
async function findUnsettledRentals(type: SettlementType, from: string, to: string) {
  const rentals = await prisma.seasonalRental.findMany({
    where: {
      [SETTLEMENT_FIELD[type]]: null,
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
      // Se o aluguel tem diárias customizadas, o repasse tem que usar as
      // mesmas — senão o valor fechado aqui não bateria com o Total David
      // mostrado no próprio aluguel.
      nightRateOverrides: readNightRateOverrides(rental.nightRateOverrides),
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

/** Um aluguel pendente de repasse, já com os valores derivados recalculados. */
type UnsettledRental = Awaited<ReturnType<typeof findUnsettledRentals>>[number];

/**
 * Quanto UM aluguel contribui para a trilha informada. É a mesma conta que o
 * modal de fechamento mostra linha a linha, e as três trilhas somadas fecham
 * exatamente o valor recebido do aluguel (`netForDistribution` já é
 * `netAmountReceived − totalDavid − cleaningFee`).
 */
function rentalShare(type: SettlementType, rental: UnsettledRental): number {
  if (type === "DAVID") return rental.computed.totalDavid;
  // A limpeza é repassada pelo valor cheio informado no aluguel — não entra
  // em nenhum rateio, é o que se paga a quem limpa.
  if (type === "LIMPEZA") return rental.cleaningFee;
  return rental.computed.netForDistribution;
}

/**
 * Calcula quanto seria o repasse do período, SEM gravar nada no banco — usado
 * pela tela de "Fechar repasse" para mostrar ao usuário o valor antes de ele
 * confirmar. Só o tipo FAMILIA divide o total por 2 (o repasse familiar é
 * compartilhado entre duas partes); DAVID e LIMPEZA somam o valor cheio.
 */
export async function previewSettlement(type: SettlementType, from: string, to: string) {
  const rentals = await findUnsettledRentals(type, from, to);
  const sum = rentals.reduce((acc, r) => acc + rentalShare(type, r), 0);
  const totalAmount = type === "FAMILIA" ? sum / 2 : sum;
  return { totalAmount, rentalCount: rentals.length, rentals };
}

/**
 * Confirma o repasse: cria o registro de `RentalSettlement` e trava todos os
 * aluguéis envolvidos (marcando a coluna de settlement daquela trilha) para
 * que não entrem em um repasse futuro do mesmo tipo. Retorna `null` se não
 * havia nenhum aluguel pendente no período (nada a fazer).
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
    data: { [SETTLEMENT_FIELD[type]]: settlement.id },
  });

  return settlement;
}
