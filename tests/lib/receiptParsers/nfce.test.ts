import { describe, expect, it } from "vitest";
import { looksLikeNfce, parseNfceReceipt } from "@/lib/receiptParsers/nfce";

/**
 * Linhas no formato que o portal da SEFAZ-MG produz quando o usuário salva a
 * página da NFC-e como PDF. A peculiaridade central desse formato (e o motivo
 * de vários testes aqui) é que ele mistura DOIS padrões numéricos na mesma
 * linha: a quantidade usa PONTO decimal ("1.580" = 1,58 unidades) e o valor em
 * reais usa VÍRGULA decimal ("R$ 3,98").
 */
const item = (
  nome: string,
  codigo: string,
  qtde: string,
  unidade: string,
  valor: string,
) => `${nome} (Código: ${codigo}) Qtde total de ítens: ${qtde} UN: ${unidade} Valor total R$: R$ ${valor}`;

const notaCompleta = [
  "Nota Fiscal de Consumidor Eletrônica",
  "SUPERMERCADO BH LTDA",
  "CNPJ: 12.345.678/0001-90",
  "Modelo Série Número Data Emissão",
  "65 1 123456 15/08/2026 19:42:07",
  item("ARROZ TIPO 1 5KG", "123", "1.000", "UN", "25,90"),
  item("BANANA PRATA KG", "456", "1.580", "KG", "3,98"),
  "Valor total do serviço",
  "R$ 29,88",
];

describe("looksLikeNfce", () => {
  it("reconhece uma NFC-e com pelo menos um item", () => {
    expect(looksLikeNfce(notaCompleta)).toBe(true);
  });

  it("não reconhece um texto com o título mas sem nenhum item", () => {
    expect(looksLikeNfce(["Nota Fiscal de Consumidor Eletrônica", "sem itens aqui"])).toBe(false);
  });

  it("não reconhece itens sem o título da NFC-e", () => {
    expect(looksLikeNfce([item("ARROZ", "1", "1.000", "UN", "10,00")])).toBe(false);
  });

  it("não reconhece texto vazio", () => {
    expect(looksLikeNfce([])).toBe(false);
  });

  it("aceita item com espaços em volta da linha", () => {
    expect(
      looksLikeNfce([
        "Nota Fiscal de Consumidor Eletrônica",
        `   ${item("ARROZ", "1", "1.000", "UN", "10,00")}   `,
      ]),
    ).toBe(true);
  });
});

describe("parseNfceReceipt — dados da nota", () => {
  it("lê estabelecimento, CNPJ, data e total oficial", () => {
    const r = parseNfceReceipt(notaCompleta);
    expect(r.storeName).toBe("SUPERMERCADO BH LTDA");
    expect(r.cnpj).toBe("12.345.678/0001-90");
    expect(r.date).toEqual(new Date(2026, 7, 15, 19, 42, 7));
    expect(r.officialTotal).toBe(29.88);
  });

  it("usa 'Supermercado' quando não encontra o CNPJ", () => {
    const r = parseNfceReceipt([
      "Nota Fiscal de Consumidor Eletrônica",
      item("ARROZ", "1", "1.000", "UN", "10,00"),
    ]);
    expect(r.storeName).toBe("Supermercado");
    expect(r.cnpj).toBeUndefined();
  });

  it("usa 'Supermercado' quando o CNPJ é a primeira linha (não há nome antes dele)", () => {
    const r = parseNfceReceipt(["CNPJ: 12.345.678/0001-90"]);
    expect(r.storeName).toBe("Supermercado");
    // O CNPJ em si continua sendo lido.
    expect(r.cnpj).toBe("12.345.678/0001-90");
  });

  it("fica sem data quando o cabeçalho de emissão não existe", () => {
    const r = parseNfceReceipt(["Nota Fiscal de Consumidor Eletrônica"]);
    expect(r.date).toBeUndefined();
  });

  it("fica sem data quando a linha após o cabeçalho não tem data/hora", () => {
    const r = parseNfceReceipt(["Modelo Série Número Data Emissão", "linha sem data"]);
    expect(r.date).toBeUndefined();
  });

  it("fica sem data quando o cabeçalho de emissão é a última linha", () => {
    const r = parseNfceReceipt(["Modelo Série Número Data Emissão"]);
    expect(r.date).toBeUndefined();
  });

  it("fica sem total oficial quando o rótulo não existe", () => {
    const r = parseNfceReceipt([item("ARROZ", "1", "1.000", "UN", "10,00")]);
    expect(r.officialTotal).toBeUndefined();
  });

  it("fica sem total oficial quando a linha seguinte ao rótulo não é um valor", () => {
    const r = parseNfceReceipt(["Valor total do serviço", "não é valor"]);
    expect(r.officialTotal).toBeUndefined();
  });

  it("normaliza total oficial negativo para positivo", () => {
    const r = parseNfceReceipt(["Valor total do serviço", "R$ -29,88"]);
    expect(r.officialTotal).toBe(29.88);
  });

  it("lê total oficial com separador de milhar", () => {
    const r = parseNfceReceipt(["Valor total do serviço", "R$ 1.234,56"]);
    expect(r.officialTotal).toBe(1234.56);
  });
});

describe("parseNfceReceipt — itens", () => {
  it("lê cada item com descrição, código, quantidade, unidade e valor", () => {
    const r = parseNfceReceipt(notaCompleta);
    expect(r.items).toEqual([
      { description: "ARROZ TIPO 1 5KG", code: "123", quantity: 1, unit: "UN", amount: 25.9 },
      { description: "BANANA PRATA KG", code: "456", quantity: 1.58, unit: "KG", amount: 3.98 },
    ]);
  });

  it("lê a quantidade com PONTO decimal (formato próprio da NFC-e)", () => {
    const r = parseNfceReceipt([item("QUEIJO", "9", "0.500", "KG", "22,45")]);
    expect(r.items[0].quantity).toBe(0.5);
  });

  it("lê o valor em reais com VÍRGULA decimal e ponto de milhar", () => {
    const r = parseNfceReceipt([item("TV", "9", "1.000", "UN", "1.999,90")]);
    expect(r.items[0].amount).toBe(1999.9);
  });

  it("normaliza valor de item negativo para positivo", () => {
    const r = parseNfceReceipt([item("DEVOLUCAO", "9", "1.000", "UN", "-10,00")]);
    expect(r.items[0].amount).toBe(10);
  });

  it("remove espaços em volta da descrição do produto", () => {
    const r = parseNfceReceipt([item("  ARROZ COM ESPACO  ", "1", "1.000", "UN", "10,00")]);
    expect(r.items[0].description).toBe("ARROZ COM ESPACO");
  });

  it("ignora linhas que não são itens", () => {
    const r = parseNfceReceipt([
      "Nota Fiscal de Consumidor Eletrônica",
      "texto qualquer do rodapé",
      item("ARROZ", "1", "1.000", "UN", "10,00"),
      "Consulte pela Chave de Acesso",
    ]);
    expect(r.items).toHaveLength(1);
  });

  it("devolve lista vazia quando não há item nenhum", () => {
    const r = parseNfceReceipt(["Nota Fiscal de Consumidor Eletrônica"]);
    expect(r.items).toEqual([]);
    expect(r.computedTotal).toBe(0);
  });
});

describe("parseNfceReceipt — total calculado", () => {
  it("soma o valor de todos os itens", () => {
    expect(parseNfceReceipt(notaCompleta).computedTotal).toBeCloseTo(29.88, 10);
  });

  it("é independente do total oficial (serve para conferência)", () => {
    const r = parseNfceReceipt([
      item("ARROZ", "1", "1.000", "UN", "10,00"),
      "Valor total do serviço",
      "R$ 99,00",
    ]);
    expect(r.computedTotal).toBe(10);
    expect(r.officialTotal).toBe(99);
  });
});
