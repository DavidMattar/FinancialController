import { describe, expect, it } from "vitest";
import { santanderParser } from "@/lib/invoiceParsers/santander";

/**
 * As linhas usadas aqui imitam a saída de `extractPdfLines` para uma fatura
 * real do Santander: texto em ordem bruta, uma linha por linha visual do PDF,
 * com o bloco de cada titular seguido pelos cabeçalhos de seção
 * ("Despesas", "Pagamento e Demais Créditos", "Parcelamentos").
 *
 * O parser é uma máquina de estados (titular atual + seção atual), então boa
 * parte dos testes é sobre TRANSIÇÃO de estado: o que acontece com um
 * lançamento fora de seção, depois de um novo titular, depois de "VALOR TOTAL".
 */
const cabecalho = [
  "BANCO SANTANDER (BRASIL) S.A.",
  "Vencimento",
  "15/08/2026",
  "Total desta Fatura R$",
  "2.829,29",
  "Pagamento Mínimo R$",
  "282,92",
  "Detalhamento da Fatura",
];

const titular = "DAVID MATTAR - 1234 XXXX XXXX 8258";

describe("santanderParser.matches", () => {
  it("reconhece pelo nome do banco", () => {
    expect(santanderParser.matches(["BANCO SANTANDER (BRASIL) S.A."])).toBe(true);
  });

  it("reconhece pelo título do detalhamento", () => {
    expect(santanderParser.matches(["Detalhamento da Fatura"])).toBe(true);
  });

  it("não reconhece o PDF de outro banco", () => {
    expect(santanderParser.matches(["BANCO ITAU", "Fatura do cartão"])).toBe(false);
  });

  it("não reconhece lista vazia", () => {
    expect(santanderParser.matches([])).toBe(false);
  });

  it("declara o banco que sabe ler", () => {
    expect(santanderParser.bank).toBe("Santander");
  });
});

describe("santanderParser.parse — dados gerais da fatura", () => {
  it("lê vencimento, total oficial e pagamento mínimo", () => {
    const r = santanderParser.parse([...cabecalho], "2026-08");
    expect(r.bank).toBe("Santander");
    expect(r.referenceMonth).toBe("2026-08");
    expect(r.dueDate).toEqual(new Date(2026, 7, 15));
    expect(r.totalAmount).toBe(2829.29);
    expect(r.minPayment).toBe(282.92);
  });

  it("cai no total calculado quando o total oficial não está no PDF", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "05/08 SUPERMERCADO BH 150,00"],
      "2026-08",
    );
    expect(r.totalAmount).toBe(150);
    expect(r.computedTotal).toBe(150);
    expect(r.minPayment).toBeUndefined();
    expect(r.dueDate).toBeUndefined();
  });

  it("ignora o rótulo de vencimento quando a linha seguinte não é uma data", () => {
    const r = santanderParser.parse(["BANCO SANTANDER", "Vencimento", "não é data"], "2026-08");
    expect(r.dueDate).toBeUndefined();
  });

  it("ignora um rótulo de total cuja linha seguinte não é um valor", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", "Total desta Fatura R$", "indisponível"],
      "2026-08",
    );
    expect(r.totalAmount).toBe(0);
  });

  it("ignora um rótulo que é a última linha do arquivo", () => {
    const r = santanderParser.parse(["BANCO SANTANDER", "Pagamento Mínimo R$"], "2026-08");
    expect(r.minPayment).toBeUndefined();
  });

  it("normaliza total negativo para positivo", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", "Total desta Fatura R$", "-100,00"],
      "2026-08",
    );
    expect(r.totalAmount).toBe(100);
  });
});

describe("santanderParser.parse — lançamentos de despesa", () => {
  it("lê data, descrição e valor, associando ao titular e cartão do bloco", () => {
    const r = santanderParser.parse(
      [...cabecalho, titular, "Despesas", "Compra Data Descrição Valor R$", "05/08 SUPERMERCADO BH 150,00"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toEqual({
      date: new Date(2026, 7, 5),
      description: "SUPERMERCADO BH",
      amount: 150,
      amountUsd: undefined,
      type: "EXPENSE",
      section: "DESPESA",
      installmentCurrent: undefined,
      installmentTotal: undefined,
      cardHolder: "DAVID MATTAR",
      cardLastDigits: "8258",
    });
  });

  it("converte o formato brasileiro de número (milhar com ponto)", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "05/08 COMPRA GRANDE 1.234,56"],
      "2026-08",
    );
    expect(r.transactions[0].amount).toBe(1234.56);
  });

  it("lê parcelas no formato 2/10", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "10/07 SHOPEE 2/10 45,50"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({
      description: "SHOPEE",
      installmentCurrent: 2,
      installmentTotal: 10,
      amount: 45.5,
    });
  });

  it("lê a segunda coluna de valor como valor em dólar (compra no exterior)", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "12/07 STEAM GAMES 108,50 20,00"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({ amount: 108.5, amountUsd: 20 });
  });

  it("ignora um número de sequência no começo da linha", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "1 05/08 PADARIA CENTRAL 12,00"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({ description: "PADARIA CENTRAL", amount: 12 });
  });

  it("transforma valor negativo em positivo (o sinal fica no campo type)", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "05/08 AJUSTE -30,00"],
      "2026-08",
    );
    expect(r.transactions[0].amount).toBe(30);
  });

  it("descarta linha cuja descrição fica vazia depois do trim", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "05/08   150,00"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(0);
  });
});

describe("santanderParser.parse — ano dos lançamentos", () => {
  it("usa o ano da referência quando o mês do lançamento é o mesmo", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "05/08 COMPRA 100,00"],
      "2026-08",
    );
    expect(r.transactions[0].date.getFullYear()).toBe(2026);
  });

  it("volta um ano quando o mês do lançamento é maior que o da referência", () => {
    // Fatura de janeiro/2026 com compra de dezembro: só pode ser de 2025.
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "20/12 COMPRA DE DEZEMBRO 100,00"],
      "2026-01",
    );
    expect(r.transactions[0].date).toEqual(new Date(2025, 11, 20));
  });

  it("mantém o ano quando o mês do lançamento é menor que o da referência", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "20/07 COMPRA DE JULHO 100,00"],
      "2026-08",
    );
    expect(r.transactions[0].date).toEqual(new Date(2026, 6, 20));
  });
});

describe("santanderParser.parse — seções", () => {
  it("marca PAGAMENTO como type PAYMENT na seção de créditos", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        titular,
        "Pagamento e Demais Créditos",
        "01/08 PAGAMENTO DE FATURA-INTERNET 2.242,41",
      ],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({ type: "PAYMENT", section: "CREDITO" });
  });

  it("marca outros créditos como INCOME", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Pagamento e Demais Créditos", "02/08 ESTORNO COMPRA 50,00"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({ type: "INCOME", section: "CREDITO" });
  });

  it("lê a seção de parcelamentos como despesa", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Parcelamentos", "03/06 GELADEIRA 3/12 250,00"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({
      type: "EXPENSE",
      section: "PARCELAMENTO",
      installmentCurrent: 3,
      installmentTotal: 12,
    });
  });

  it("ignora lançamento que aparece antes de qualquer cabeçalho de seção", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "05/08 FORA DE SECAO 100,00"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(0);
  });

  it("'VALOR TOTAL' encerra a seção corrente", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        titular,
        "Despesas",
        "05/08 ANTES DO TOTAL 100,00",
        "VALOR TOTAL 100,00",
        "06/08 DEPOIS DO TOTAL 200,00",
      ],
      "2026-08",
    );
    expect(r.transactions.map((t) => t.description)).toEqual(["ANTES DO TOTAL"]);
  });

  it("ignora o cabeçalho de colunas da tabela", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "Compra Data Descrição Valor R$ Valor US$"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(0);
  });

  it("ignora linhas em branco", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "", "   ", "05/08 COMPRA 100,00"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(1);
  });
});

describe("santanderParser.parse — múltiplos titulares", () => {
  it("associa cada lançamento ao titular e cartão do seu bloco", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        "DAVID MATTAR - 1234 XXXX XXXX 8258",
        "Despesas",
        "05/08 COMPRA DO DAVID 100,00",
        "MARIA SOUZA - 1234 XXXX XXXX 4321",
        "Despesas",
        "06/08 COMPRA DA MARIA 200,00",
      ],
      "2026-08",
    );
    expect(r.transactions).toEqual([
      expect.objectContaining({
        description: "COMPRA DO DAVID",
        cardHolder: "DAVID MATTAR",
        cardLastDigits: "8258",
      }),
      expect.objectContaining({
        description: "COMPRA DA MARIA",
        cardHolder: "MARIA SOUZA",
        cardLastDigits: "4321",
      }),
    ]);
  });

  it("a linha de titular zera a seção (lançamento seguinte sem seção é ignorado)", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        "DAVID MATTAR - 1234 XXXX XXXX 8258",
        "Despesas",
        "05/08 COMPRA DO DAVID 100,00",
        "MARIA SOUZA - 1234 XXXX XXXX 4321",
        "06/08 SEM SECAO 200,00",
      ],
      "2026-08",
    );
    expect(r.transactions.map((t) => t.description)).toEqual(["COMPRA DO DAVID"]);
  });

  it("aceita a linha de titular com prefixo @ e sem espaços no número", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", "@ JOAO SILVA - 1234XXXXXXXX5678", "Despesas", "05/08 COMPRA 10,00"],
      "2026-08",
    );
    expect(r.transactions[0]).toMatchObject({
      cardHolder: "JOAO SILVA",
      cardLastDigits: "5678",
    });
  });
});

describe("santanderParser.parse — IOF de compra no exterior", () => {
  it("usa a data do lançamento anterior", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        titular,
        "Despesas",
        "12/07 STEAM GAMES 108,50 20,00",
        "IOF DESPESA NO EXTERIOR 5,42",
      ],
      "2026-08",
    );
    expect(r.transactions[1]).toMatchObject({
      description: "IOF - despesa no exterior",
      amount: 5.42,
      type: "EXPENSE",
      section: "DESPESA",
      date: new Date(2026, 6, 12),
    });
  });

  it("cai no primeiro dia do mês de referência quando é o primeiro lançamento", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "IOF DESPESA NO EXTERIOR 5,42"],
      "2026-08",
    );
    expect(r.transactions[0].date).toEqual(new Date(2026, 7, 1));
  });

  it("é ignorado fora da seção de despesas", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        titular,
        "Pagamento e Demais Créditos",
        "IOF DESPESA NO EXTERIOR 5,42",
      ],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(0);
  });

  it("reconhece a linha independente da caixa das letras", () => {
    const r = santanderParser.parse(
      ["BANCO SANTANDER", titular, "Despesas", "Iof Despesa No Exterior 5,42"],
      "2026-08",
    );
    expect(r.transactions).toHaveLength(1);
  });
});

describe("santanderParser.parse — total calculado", () => {
  it("soma despesas e subtrai créditos e pagamentos", () => {
    const r = santanderParser.parse(
      [
        "BANCO SANTANDER",
        titular,
        "Despesas",
        "05/08 COMPRA A 100,00",
        "06/08 COMPRA B 50,00",
        "Pagamento e Demais Créditos",
        "01/08 PAGAMENTO FATURA 30,00",
        "02/08 ESTORNO 20,00",
      ],
      "2026-08",
    );
    // 100 + 50 − 30 − 20
    expect(r.computedTotal).toBe(100);
  });

  it("é zero quando não há lançamento nenhum", () => {
    const r = santanderParser.parse(["BANCO SANTANDER"], "2026-08");
    expect(r.computedTotal).toBe(0);
    expect(r.transactions).toEqual([]);
  });

  it("não sobrescreve o total oficial do banco pelo calculado", () => {
    const r = santanderParser.parse(
      [...cabecalho, titular, "Despesas", "05/08 COMPRA 10,00"],
      "2026-08",
    );
    expect(r.totalAmount).toBe(2829.29);
    expect(r.computedTotal).toBe(10);
  });
});
