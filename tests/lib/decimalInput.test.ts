import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decimalField, parseDecimalInput, parseDecimalInputOr } from "@/lib/decimalInput";

describe("parseDecimalInput — separador decimal", () => {
  it("aceita vírgula e ponto como o MESMO separador decimal", () => {
    // É o pedido central: "3,07" e "3.07" são o mesmo número para o sistema.
    expect(parseDecimalInput("3,07")).toBe(3.07);
    expect(parseDecimalInput("3.07")).toBe(3.07);
  });

  it("lê número sem separador nenhum", () => {
    expect(parseDecimalInput("42")).toBe(42);
    expect(parseDecimalInput("0")).toBe(0);
  });

  it("aceita muitas casas decimais (quantidade de cripto)", () => {
    expect(parseDecimalInput("0,00012345")).toBe(0.00012345);
    expect(parseDecimalInput("0.00012345")).toBe(0.00012345);
  });

  it("aceita separador decimal sem parte inteira ou sem parte decimal", () => {
    expect(parseDecimalInput(",5")).toBe(0.5);
    expect(parseDecimalInput("1.")).toBe(1);
  });
});

describe("parseDecimalInput — separador de milhar", () => {
  it("lê o formato brasileiro com ponto de milhar e vírgula decimal", () => {
    // Era exatamente este o valor que quebrava o cadastro de cripto: o
    // `Number(valor.replace(",", "."))` de antes devolvia NaN aqui.
    expect(parseDecimalInput("350.000,00")).toBe(350000);
    expect(parseDecimalInput("1.234,56")).toBe(1234.56);
  });

  it("lê o formato americano com vírgula de milhar e ponto decimal", () => {
    expect(parseDecimalInput("1,234.56")).toBe(1234.56);
  });

  it("trata o MESMO separador repetido como milhar", () => {
    expect(parseDecimalInput("1.234.567")).toBe(1234567);
    expect(parseDecimalInput("1,234,567")).toBe(1234567);
  });

  it("com os dois separadores, o último é o decimal", () => {
    expect(parseDecimalInput("1.2.3,4")).toBe(123.4);
    expect(parseDecimalInput("1,2,3.4")).toBe(123.4);
  });

  it("um ponto sozinho é decimal, não milhar (decisão documentada)", () => {
    // Ver o comentário no topo de src/lib/decimalInput.ts: ler três casas depois
    // de um ponto como milhar quebraria uma quantidade de cripto como "1.500".
    expect(parseDecimalInput("1.500")).toBe(1.5);
  });
});

describe("parseDecimalInput — limpeza e sinal", () => {
  it("ignora prefixo de moeda e espaços", () => {
    expect(parseDecimalInput("R$ 350.000,00")).toBe(350000);
    expect(parseDecimalInput("  12,50  ")).toBe(12.5);
  });

  it("ignora o espaço não-quebrável que o Intl usa depois do R$", () => {
    // U+00A0 montado com String.fromCharCode em vez de colado como literal: é o
    // espaço que o Intl.NumberFormat("pt-BR") coloca entre "R$" e o número
    // (mesma armadilha do tests/helpers/text.ts), e como caractere invisível no
    // meio do código ninguém lendo o teste saberia que ele está ali.
    const espacoNaoQuebravel = String.fromCharCode(0xa0);
    expect(parseDecimalInput("R$" + espacoNaoQuebravel + "1.234,56")).toBe(1234.56);
  });

  it("aceita sinal na frente", () => {
    expect(parseDecimalInput("-3,07")).toBe(-3.07);
    expect(parseDecimalInput("+3,07")).toBe(3.07);
    expect(parseDecimalInput("-1.234,56")).toBe(-1234.56);
  });

  it("recusa sinal no meio do número", () => {
    expect(parseDecimalInput("3-07")).toBeNull();
  });
});

describe("parseDecimalInput — o que devolve null", () => {
  it("campo vazio ou só com espaços", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("   ")).toBeNull();
  });

  it("texto sem nenhum dígito", () => {
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseDecimalInput(",")).toBeNull();
    expect(parseDecimalInput("R$")).toBeNull();
  });

  it("campo ausente (null/undefined)", () => {
    expect(parseDecimalInput(null)).toBeNull();
    expect(parseDecimalInput(undefined)).toBeNull();
  });

  it("número grande demais para o ponto flutuante", () => {
    // 400 dígitos passam de Number.MAX_VALUE e viram Infinity — que não é um
    // valor financeiro utilizável, então sai como "não é número".
    expect(parseDecimalInput("9".repeat(400))).toBeNull();
  });
});

describe("parseDecimalInput — valor que já é número", () => {
  it("devolve o próprio número", () => {
    expect(parseDecimalInput(3.07)).toBe(3.07);
    expect(parseDecimalInput(0)).toBe(0);
    expect(parseDecimalInput(-5)).toBe(-5);
  });

  it("recusa NaN e Infinity", () => {
    expect(parseDecimalInput(NaN)).toBeNull();
    expect(parseDecimalInput(Infinity)).toBeNull();
  });
});

/**
 * Tabela de entradas numéricas — a varredura de "todos os caminhos possíveis".
 *
 * Cada linha é [texto digitado, número esperado, por quê]. Ficam juntas numa
 * tabela, e não espalhadas em `it`s temáticos, porque o valor deste teste está
 * em poder LER de uma vez o que o sistema faz com cada formato — inclusive nos
 * casos em que a resposta é "recusa".
 */
const TABELA: [string, number | null, string][] = [
  // ------------------------------------------------- separador de milhar
  ["1.000,00", 1000, "formato brasileiro: ponto de milhar, vírgula decimal"],
  ["1,000.00", 1000, "formato americano: vírgula de milhar, ponto decimal"],
  ["1.000.000", 1_000_000, "ponto repetido só existe como milhar"],
  ["1,000,000", 1_000_000, "vírgula repetida idem"],
  ["1.000.000,00", 1_000_000, "milhar repetido + decimal"],
  ["1,000,000.00", 1_000_000, "idem no formato americano"],
  ["10.000.000,99", 10_000_000.99, "milhões com centavos"],
  ["10000000,00", 10_000_000, "sem separador de milhar, vírgula decimal"],
  ["10000000.00", 10_000_000, "sem separador de milhar, ponto decimal"],

  // -------------------------------------- o caso ambíguo, decidido e documentado
  ["1.000", 1, "UM ponto sozinho é decimal: para mil, escreva 1.000,00"],
  ["1,000", 1, "mesma regra com vírgula, por simetria"],
  ["1.500", 1.5, "é o que protege a quantidade de cripto (1,5 ETH)"],

  // ---------------------------------------------------------- precisão
  ["3,07", 3.07, "o pedido original: vírgula decimal"],
  ["3.07", 3.07, "e o mesmo número com ponto"],
  ["0,00000001", 1e-8, "8 casas = precisão de satoshi, o limite da coluna quantity"],
  ["0,000000000000000001", 1e-18, "18 casas (wei) ainda cabem no double"],
  [
    "10,0000000000000000000000000001",
    10,
    "além de ~17 dígitos o double não guarda a diferença: vira 10",
  ],
  ["999999999999999999999", 1e21, "número enorme ainda é finito, então passa"],

  // -------------------------------------------------------------- sinal
  ["-1.234,56", -1234.56, "negativo com milhar"],
  ["+1.234,56", 1234.56, "sinal de mais é aceito e ignorado"],
  ["-0,5", -0.5, "negativo fracionário"],
  ["-R$ 5,50", -5.5, "sinal vem ANTES do prefixo de moeda"],

  // ------------------------------------------------ ruído conhecido (removido)
  ["R$ 1.234,56", 1234.56, "prefixo de moeda com espaço"],
  ["R$1.234,56", 1234.56, "prefixo de moeda sem espaço"],
  ["US$ 10.50", 10.5, "dólar"],
  ["€ 9,99", 9.99, "euro"],
  ["1 234,56", 1234.56, "espaço usado como separador de milhar"],
  ["  12,50  ", 12.5, "espaço em volta"],

  // --------------------------------------------- ruído desconhecido (recusado)
  ["1e3", null, "notação científica NÃO é lida como 1000 nem mangled para 13"],
  ["12abc", null, "letra depois do número recusa, não vira 12"],
  ["abc12", null, "letra antes idem"],
  ["1%", null, "percentual não é valor monetário"],
  ["50 %", null, "idem com espaço"],
  ["1'234.56", null, "apóstrofo suíço de milhar não é previsto"],
  ["1-2", null, "sinal no meio não é número"],
  ["--5", null, "sinal duplicado"],
  ["1.000,000,00", null, "separadores embaralhados demais para decidir"],
  ["abc", null, "texto puro"],
  ["R$", null, "moeda sem número"],
  ["", null, "campo vazio"],
  ["   ", null, "só espaços"],
  ["-", null, "só o sinal"],
  [",", null, "só o separador"],
  [".", null, "idem"],

  // ------------------------------------------------------------- bordas
  [".5", 0.5, "sem parte inteira, ponto"],
  [",5", 0.5, "sem parte inteira, vírgula"],
  ["5.", 5, "sem parte decimal, ponto"],
  ["5,", 5, "sem parte decimal, vírgula"],
  ["0", 0, "zero"],
  ["0,00", 0, "zero com centavos"],
  ["00012,5", 12.5, "zeros à esquerda"],
  ["1.2.3", 123, "todos os pontos como milhar"],
  ["1,2,3", 123, "todas as vírgulas como milhar"],
];

describe("parseDecimalInput — tabela de entradas", () => {
  for (const [entrada, esperado, motivo] of TABELA) {
    it(`${JSON.stringify(entrada)} → ${esperado} (${motivo})`, () => {
      expect(parseDecimalInput(entrada)).toBe(esperado);
    });
  }

  it("cobre os dois resultados possíveis (número e recusa)", () => {
    // Guarda contra a tabela virar só casos de sucesso com o tempo: o valor
    // dela está justamente em documentar o que o sistema RECUSA.
    expect(TABELA.some(([, esperado]) => esperado === null)).toBe(true);
    expect(TABELA.some(([, esperado]) => esperado !== null)).toBe(true);
  });
});

describe("decimalField — a API aceita a mesma tabela que a tela", () => {
  // A tela já converte antes de enviar, mas a rota é a fronteira do sistema:
  // quem chamar direto (outro cliente, um script, um curl) tem que receber o
  // mesmo tratamento, senão o comportamento passa a depender de quem formatou.
  const schema = z.object({ valor: decimalField(z.number()) });

  for (const [entrada, esperado] of TABELA) {
    it(`${JSON.stringify(entrada)} → ${esperado === null ? "400" : esperado}`, () => {
      const resultado = schema.safeParse({ valor: entrada });
      if (esperado === null) {
        expect(resultado.success).toBe(false);
      } else {
        expect(resultado.data?.valor).toBe(esperado);
      }
    });
  }
});

describe("parseDecimalInputOr", () => {
  it("devolve o número quando dá para ler", () => {
    expect(parseDecimalInputOr("3,07", 0)).toBe(3.07);
  });

  it("devolve o padrão quando não dá", () => {
    expect(parseDecimalInputOr("", 0)).toBe(0);
    expect(parseDecimalInputOr("abc", 180)).toBe(180);
  });
});

describe("decimalField (schema zod)", () => {
  const schema = z.object({ amount: decimalField(z.number().positive()) });

  it("aceita número, como antes", () => {
    expect(schema.parse({ amount: 3.07 })).toEqual({ amount: 3.07 });
  });

  it("aceita string com vírgula ou ponto decimal", () => {
    expect(schema.parse({ amount: "3,07" })).toEqual({ amount: 3.07 });
    expect(schema.parse({ amount: "3.07" })).toEqual({ amount: 3.07 });
    expect(schema.parse({ amount: "1.234,56" })).toEqual({ amount: 1234.56 });
  });

  it("continua aplicando a restrição do schema interno", () => {
    // A string é convertida, mas o `.positive()` continua valendo.
    expect(schema.safeParse({ amount: "-1" }).success).toBe(false);
    expect(schema.safeParse({ amount: "0" }).success).toBe(false);
  });

  it("recusa string que não descreve número, sem virar NaN", () => {
    const result = schema.safeParse({ amount: "abc" });
    expect(result.success).toBe(false);
    // A string é repassada intacta, então o erro fala de tipo (string onde se
    // esperava number) em vez de reclamar de um NaN.
    expect(JSON.stringify(result.error?.issues)).toContain("number");
  });

  it("deixa null passar para o schema interno (campo anulável)", () => {
    const nullable = z.object({ amount: decimalField(z.number().nullable()) });
    expect(nullable.parse({ amount: null })).toEqual({ amount: null });
  });

  it("preserva campo opcional e valor padrão", () => {
    const opcional = z.object({
      amount: decimalField(z.number().optional()),
      fee: decimalField(z.number().default(0)),
    });
    expect(opcional.parse({})).toEqual({ fee: 0 });
  });
});
