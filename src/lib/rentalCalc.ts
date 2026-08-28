import { computeTableValue, nightsBetween } from "./rentalPriceTable";

/** Todos os valores derivados de um aluguel de temporada, prontos para exibir na tela e nos relatórios. */
export interface RentalComputed {
  /** Número de noites da estadia. */
  nights: number;
  /** Valor de tabela (referência) para as datas escolhidas — ver `computeTableValue`. */
  tableValue: number;
  /** 10% do valor líquido recebido — o "piso" garantido do David. */
  davidTenPercent: number;
  /** Soma de todos os gastos extras informados (material, gás, limpeza extra, etc). */
  extrasTotal: number;
  /**
   * Quanto o valor líquido recebido superou (ou ficou abaixo, se negativo)
   * do valor de tabela, já descontados os 10% do David, a limpeza e os
   * extras. Positivo = reserva saiu mais cara que a tabela; negativo =
   * reserva saiu mais barata que a tabela (ex: desconto, promoção).
   */
  extraTableValue: number;
  /** Valor final que o David recebe deste aluguel (10% + metade do extra de tabela, nunca menos que o piso de 10%). */
  totalDavid: number;
  /** O que resta para dividir entre a família, depois de retirar o total do David e a limpeza. */
  netForDistribution: number;
}

/**
 * Calcula a divisão de receita de um aluguel de temporada (Airbnb/Booking)
 * entre o David e a família, a partir dos dados básicos informados no
 * formulário de novo aluguel.
 *
 * Fórmula (nesta ordem):
 * 1. `davidTenPercent` = 10% do valor líquido recebido (piso garantido).
 * 2. `tableValue` = valor de tabela para as datas (ver `rentalPriceTable.ts`).
 * 3. `extraTableValue` = o que sobrou do valor recebido depois de tirar os
 *    10% do David, a limpeza, o valor de tabela e os extras — ou seja,
 *    "quanto a reserva rendeu além (ou abaixo) da tabela".
 * 4. `totalDavid` = 10% + metade do `extraTableValue` (só quando positivo).
 * 5. `netForDistribution` = valor recebido − `totalDavid` − limpeza.
 */
export function computeRental(params: {
  checkIn: Date;
  checkOut: Date;
  netAmountReceived: number;
  cleaningFee: number;
  extrasTotal: number;
}): RentalComputed {
  const nights = nightsBetween(params.checkIn, params.checkOut);
  const tableValue = computeTableValue(params.checkIn, params.checkOut);
  const davidTenPercent = params.netAmountReceived * 0.1;
  const extraTableValue =
    params.netAmountReceived - davidTenPercent - params.cleaningFee - tableValue - params.extrasTotal;
  // O piso do David é sempre os 10% — um extraTableValue negativo (reserva
  // veio abaixo do valor de tabela) nunca reduz esse piso. Qualquer
  // diferença negativa é absorvida pelo lado da distribuição familiar, não
  // pelo David.
  const totalDavid = davidTenPercent + Math.max(0, 0.5 * extraTableValue);
  const netForDistribution = params.netAmountReceived - totalDavid - params.cleaningFee;

  return {
    nights,
    tableValue,
    davidTenPercent,
    extrasTotal: params.extrasTotal,
    extraTableValue,
    totalDavid,
    netForDistribution,
  };
}
