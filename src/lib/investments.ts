/**
 * Matemática de uma posição de investimento — o único lugar que transforma
 * COMPRAS individuais (`InvestmentPurchase`) em posição fechada e em resultado
 * por compra.
 *
 * Por que existe: a tela de Investimentos mostra a posição compactada (total
 * investido, valor atual, lucro em R$ e em %) e permite expandir o ativo para
 * ver o resultado de CADA compra separadamente — mesmo padrão da transação de
 * supermercado que expande em sub-itens. As duas visões precisam fechar entre
 * si, então as duas saem daqui: a soma das compras é, por construção, o total
 * da posição.
 *
 * O banco guarda somente as compras. Quantidade total e custo médio ponderado
 * **não são colunas** — são derivados na leitura, toda vez. É a mesma regra do
 * `tableValue` de aluguel de temporada (seção 6 do contexto.md): o que se salva
 * é a entrada que o usuário informou (quantidade e preço pago naquele aporte),
 * nunca o resultado do cálculo. É também o que torna impossível o total
 * divergir das compras que o compõem.
 *
 * Toda função aqui é pura (não toca banco nem rede), para o cálculo poder ser
 * testado sozinho e para a rota de preços só precisar juntar cotação + compras.
 */

/**
 * Uma compra como ela sai do banco.
 *
 * Os dois valores monetários são `unknown` de propósito, mesma convenção do
 * `SeasonalRentalRecord`: o Prisma entrega `Decimal`, o `JSON.stringify`
 * entrega string e um teste entrega number — todos passam por `Number()` aqui
 * dentro, e tipar como `unknown` evita espalhar o tipo do Prisma por uma lib
 * que é pura de propósito.
 */
export interface PurchaseRecord {
  id: string;
  quantity: unknown;
  unitCostBrl: unknown;
  createdAt: Date | string;
}

/** Resultado calculado de UMA compra, já com a cotação atual aplicada. */
export interface PurchaseResult {
  id: string;
  /** Instante em que a compra foi registrada, em ISO. */
  createdAt: string;
  quantity: number;
  /** Reais pagos por unidade nesta compra. */
  unitCostBrl: number;
  /** `quantity * unitCostBrl` — quanto esta compra custou. */
  cost: number;
  /** `quantity * cotação atual`, ou null quando a cotação não veio. */
  currentValue: number | null;
  /** Lucro/prejuízo desta compra em reais, ou null sem cotação. */
  gainLoss: number | null;
  /** O mesmo em percentual sobre o custo desta compra; null se o custo é 0. */
  gainLossPercent: number | null;
}

/** A posição consolidada: a soma das compras. */
export interface AggregatedPosition {
  /** Soma das quantidades compradas. */
  quantity: number;
  /** Soma do que foi pago (`Σ quantity × unitCostBrl`). */
  cost: number;
  /**
   * Custo médio ponderado pela quantidade de cada compra (`cost / quantity`).
   * É 0 quando não há quantidade nenhuma — e não `NaN`, que contaminaria a
   * exibição inteira.
   */
  avgCostBrl: number;
}

/**
 * Casas decimais de `InvestmentPurchase.quantity` no banco (Decimal(20, 8)).
 * A soma das quantidades não pode ser mais precisa do que isso.
 */
const QUANTITY_DECIMALS = 8;

/**
 * Arredonda uma quantidade somada para a precisão que o banco guarda.
 *
 * Necessário porque a quantidade da posição virou uma SOMA em JavaScript (antes
 * era um `Decimal` único vindo do banco), e somar floats produz lixo no fim:
 * 0.04951677 + 0.01 dá 0.059516770000000004, que ia direto para a tela na
 * coluna "Qtd." — é o único número da tabela que aparece cru, sem passar por
 * `formatBRL`. Arredondar na precisão da própria coluna elimina o artefato sem
 * inventar precisão que o banco não tem.
 */
function roundQuantity(value: number): number {
  const factor = 10 ** QUANTITY_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Consolida uma lista de compras na posição total.
 *
 * O custo médio é **ponderado pela quantidade**, não a média simples dos
 * preços: comprar 3 unidades a R$100 e 1 a R$200 dá custo médio R$125, não
 * R$150. Sai direto de `cost / quantity`, então é impossível a média discordar
 * do total investido.
 */
export function aggregatePurchases(purchases: PurchaseRecord[]): AggregatedPosition {
  let quantity = 0;
  let cost = 0;
  for (const purchase of purchases) {
    const purchaseQuantity = Number(purchase.quantity);
    quantity += purchaseQuantity;
    cost += purchaseQuantity * Number(purchase.unitCostBrl);
  }
  quantity = roundQuantity(quantity);
  // Posição sem compra nenhuma (ou com quantidade zerada) não tem custo médio.
  return { quantity, cost, avgCostBrl: quantity > 0 ? cost / quantity : 0 };
}

/**
 * Calcula o resultado de UMA compra à cotação informada.
 *
 * @param priceBrl - Cotação atual em reais por unidade do ativo, ou `null`
 *   quando a fonte externa não respondeu (sem internet, símbolo desconhecido).
 *   Com `null`, valor atual e lucro saem nulos e a tela mostra travessão — o
 *   custo, que é dado gravado, continua aparecendo.
 */
export function computePurchaseResult(
  purchase: PurchaseRecord,
  priceBrl: number | null,
): PurchaseResult {
  const quantity = Number(purchase.quantity);
  const unitCostBrl = Number(purchase.unitCostBrl);
  const cost = quantity * unitCostBrl;
  const currentValue = priceBrl !== null ? quantity * priceBrl : null;
  const gainLoss = currentValue !== null ? currentValue - cost : null;
  return {
    id: purchase.id,
    createdAt: new Date(purchase.createdAt).toISOString(),
    quantity,
    unitCostBrl,
    cost,
    currentValue,
    gainLoss,
    // Sem custo (ativo recebido, não comprado) não existe percentual sobre o
    // que foi pago — o valor absoluto continua válido.
    gainLossPercent: gainLoss !== null && cost > 0 ? (gainLoss / cost) * 100 : null,
  };
}

/**
 * Variação da COTAÇÃO em relação ao preço pago, por unidade do ativo — é a
 * coluna "Vs. compra" da tela.
 *
 * Note que não é a mesma coisa que o lucro da posição: aqui a comparação é
 * preço contra preço (quanto uma unidade subiu), enquanto o lucro multiplica
 * isso pela quantidade. O percentual dos dois coincide; o valor em reais não.
 */
export function computePriceVsCost(
  priceBrl: number | null,
  avgCostBrl: number,
): { priceVsCost: number | null; priceVsCostPercent: number | null } {
  if (priceBrl === null) return { priceVsCost: null, priceVsCostPercent: null };
  return {
    priceVsCost: priceBrl - avgCostBrl,
    // Custo médio zero: não existe "quanto subiu em relação a zero".
    priceVsCostPercent: avgCostBrl > 0 ? ((priceBrl - avgCostBrl) / avgCostBrl) * 100 : null,
  };
}
