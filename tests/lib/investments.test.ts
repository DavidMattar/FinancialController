import { describe, expect, it } from "vitest";
import {
  aggregatePurchases,
  computePriceVsCost,
  computePurchaseResult,
  type PurchaseRecord,
} from "@/lib/investments";

/** Uma compra como o Prisma devolve (Decimal serializado como string). */
function compra(over: Partial<PurchaseRecord> = {}): PurchaseRecord {
  return {
    id: "buy-1",
    quantity: "0.5",
    unitCostBrl: "200000",
    createdAt: new Date("2026-08-20T12:00:00.000Z"),
    ...over,
  };
}

describe("aggregatePurchases", () => {
  it("soma quantidade e custo de todas as compras", () => {
    const posicao = aggregatePurchases([
      compra({ quantity: "0.5", unitCostBrl: "200000" }),
      compra({ id: "buy-2", quantity: "0.5", unitCostBrl: "300000" }),
    ]);

    expect(posicao.quantity).toBe(1);
    expect(posicao.cost).toBe(250000);
  });

  it("pondera o custo médio pela quantidade, não pela média simples dos preços", () => {
    // 3 unidades a R$100 + 1 a R$200 = R$500 por 4 unidades = R$125 de custo
    // médio. A média simples dos preços daria R$150, que estaria errado.
    const posicao = aggregatePurchases([
      compra({ quantity: 3, unitCostBrl: 100 }),
      compra({ id: "buy-2", quantity: 1, unitCostBrl: 200 }),
    ]);

    expect(posicao.avgCostBrl).toBe(125);
    expect(posicao.cost).toBe(500);
  });

  it("uma compra só devolve o próprio preço como custo médio", () => {
    const posicao = aggregatePurchases([compra({ quantity: "0.04951677", unitCostBrl: "84088.36" })]);

    expect(posicao.quantity).toBeCloseTo(0.04951677, 10);
    expect(posicao.avgCostBrl).toBeCloseTo(84088.36, 6);
  });

  it("arredonda a quantidade somada na precisão do banco (sem lixo de float)", () => {
    // 0.04951677 + 0.01 dá 0.059516770000000004 em ponto flutuante, e a coluna
    // "Qtd." da tela mostra esse número cru (é o único que não passa por
    // formatBRL). A coluna do banco é Decimal(20, 8), então 8 casas é o limite
    // real de precisão.
    const posicao = aggregatePurchases([
      compra({ quantity: "0.04951677", unitCostBrl: "84088.36" }),
      compra({ id: "buy-2", quantity: "0.01", unitCostBrl: "300000" }),
    ]);

    expect(posicao.quantity).toBe(0.05951677);
    expect(String(posicao.quantity)).toBe("0.05951677");
  });

  it("não perde casas legítimas ao arredondar (8 decimais é a precisão do satoshi)", () => {
    const posicao = aggregatePurchases([compra({ quantity: "0.00000001", unitCostBrl: "1" })]);

    expect(posicao.quantity).toBe(0.00000001);
  });

  it("posição sem compra nenhuma fica zerada, sem NaN", () => {
    // Uma divisão por zero aqui contaminaria a exibição inteira da carteira.
    expect(aggregatePurchases([])).toEqual({ quantity: 0, cost: 0, avgCostBrl: 0 });
  });

  it("aceita preço com muitas casas decimais (token barato)", () => {
    // 1 SHIB vale ~R$ 0,000026: com 2 casas o preço arredondaria para zero, e
    // é por isso que a coluna do banco tem 12 casas.
    const posicao = aggregatePurchases([compra({ quantity: "1000000", unitCostBrl: "0.000025870" })]);

    expect(posicao.cost).toBeCloseTo(25.87, 6);
    expect(posicao.avgCostBrl).toBeCloseTo(0.00002587, 12);
  });
});

describe("computePurchaseResult", () => {
  it("calcula custo, valor atual e lucro de uma compra", () => {
    const resultado = computePurchaseResult(compra({ quantity: "0.5", unitCostBrl: "200000" }), 300000);

    expect(resultado.cost).toBe(100000);
    expect(resultado.currentValue).toBe(150000);
    expect(resultado.gainLoss).toBe(50000);
    expect(resultado.gainLossPercent).toBe(50);
  });

  it("duas compras do mesmo ativo têm resultados diferentes na mesma cotação", () => {
    // É esta a informação que a visão compactada esconde e que a expandida
    // mostra: a cotação é a mesma, o preço pago em cada aporte não.
    const cotacao = 300000;
    const barata = computePurchaseResult(compra({ quantity: 1, unitCostBrl: 100000 }), cotacao);
    const cara = computePurchaseResult(compra({ id: "buy-2", quantity: 1, unitCostBrl: 400000 }), cotacao);

    expect(barata.gainLossPercent).toBe(200);
    expect(cara.gainLossPercent).toBe(-25);
  });

  it("aceita prejuízo", () => {
    const resultado = computePurchaseResult(compra({ quantity: 1, unitCostBrl: 200000 }), 150000);

    expect(resultado.gainLoss).toBe(-50000);
    expect(resultado.gainLossPercent).toBe(-25);
  });

  it("sem cotação, valor atual e lucro ficam nulos mas o custo continua", () => {
    const resultado = computePurchaseResult(compra({ quantity: 1, unitCostBrl: 200000 }), null);

    expect(resultado.cost).toBe(200000);
    expect(resultado.currentValue).toBeNull();
    expect(resultado.gainLoss).toBeNull();
    expect(resultado.gainLossPercent).toBeNull();
  });

  it("não calcula percentual quando o custo é zero (ativo recebido, não comprado)", () => {
    const resultado = computePurchaseResult(compra({ quantity: 1, unitCostBrl: 0 }), 500);

    expect(resultado.gainLoss).toBe(500);
    expect(resultado.gainLossPercent).toBeNull();
  });

  it("devolve a data da compra em ISO, aceitando Date ou string", () => {
    expect(computePurchaseResult(compra({ createdAt: new Date("2026-08-20T12:00:00.000Z") }), 1).createdAt).toBe(
      "2026-08-20T12:00:00.000Z",
    );
    expect(computePurchaseResult(compra({ createdAt: "2026-08-20T12:00:00.000Z" }), 1).createdAt).toBe(
      "2026-08-20T12:00:00.000Z",
    );
  });

  it("mantém o id da compra (é o que a tela usa para apagar a linha certa)", () => {
    expect(computePurchaseResult(compra({ id: "buy-42" }), 1).id).toBe("buy-42");
  });
});

describe("computePriceVsCost", () => {
  it("compara a cotação com o preço pago, por unidade", () => {
    expect(computePriceVsCost(300000, 200000)).toEqual({
      priceVsCost: 100000,
      priceVsCostPercent: 50,
    });
  });

  it("devolve variação negativa quando a cotação caiu abaixo do preço pago", () => {
    expect(computePriceVsCost(150000, 200000)).toEqual({
      priceVsCost: -50000,
      priceVsCostPercent: -25,
    });
  });

  it("sem cotação, os dois ficam nulos", () => {
    expect(computePriceVsCost(null, 200000)).toEqual({
      priceVsCost: null,
      priceVsCostPercent: null,
    });
  });

  it("com custo médio zero, o valor absoluto vale e o percentual não", () => {
    expect(computePriceVsCost(500, 0)).toEqual({ priceVsCost: 500, priceVsCostPercent: null });
  });
});

describe("as duas visões fecham entre si", () => {
  it("a soma dos custos das compras é o custo da posição", () => {
    const compras = [
      compra({ quantity: "0.5", unitCostBrl: "200000" }),
      compra({ id: "buy-2", quantity: "0.25", unitCostBrl: "300000" }),
      compra({ id: "buy-3", quantity: "0.25", unitCostBrl: "400000" }),
    ];
    const posicao = aggregatePurchases(compras);
    const resultados = compras.map((c) => computePurchaseResult(c, 350000));

    expect(resultados.reduce((s, r) => s + r.cost, 0)).toBeCloseTo(posicao.cost, 8);
    expect(resultados.reduce((s, r) => s + r.quantity, 0)).toBeCloseTo(posicao.quantity, 8);
  });

  it("a soma dos lucros das compras é o lucro da posição", () => {
    const compras = [
      compra({ quantity: 1, unitCostBrl: 100 }),
      compra({ id: "buy-2", quantity: 2, unitCostBrl: 400 }),
    ];
    const posicao = aggregatePurchases(compras);
    const cotacao = 300;
    const lucroDaPosicao = posicao.quantity * cotacao - posicao.cost;
    const somaDosLucros = compras.reduce(
      (soma, c) => soma + computePurchaseResult(c, cotacao).gainLoss!,
      0,
    );

    expect(somaDosLucros).toBeCloseTo(lucroDaPosicao, 8);
  });
});
