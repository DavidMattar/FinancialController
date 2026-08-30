import { describe, expect, it } from "vitest";
import { formatBRL, formatDate, monthLabel } from "@/lib/format";
import { normalizarEspacos } from "../helpers/text";

/**
 * O `Intl` usa espaço não-quebrável (U+00A0) entre "R$" e o número, e o
 * caractere exato varia entre versões do ICU. Normalizar antes de comparar
 * evita um teste que quebra ao trocar de versão do Node sem que nada do app
 * tenha mudado.
 */
const norm = normalizarEspacos;

describe("formatBRL", () => {
  it("formata como moeda brasileira", () => {
    expect(norm(formatBRL(1234.5))).toBe("R$ 1.234,50");
  });

  it("usa vírgula como separador decimal e ponto como separador de milhar", () => {
    expect(norm(formatBRL(1000000))).toBe("R$ 1.000.000,00");
  });

  it("formata zero", () => {
    expect(norm(formatBRL(0))).toBe("R$ 0,00");
  });

  it("formata valor negativo", () => {
    expect(norm(formatBRL(-45.9))).toBe("-R$ 45,90");
  });

  it("arredonda para 2 casas decimais", () => {
    expect(norm(formatBRL(0.005))).toBe("R$ 0,01");
    expect(norm(formatBRL(19.994))).toBe("R$ 19,99");
  });

  it("sempre mostra as duas casas decimais, mesmo em valor inteiro", () => {
    expect(norm(formatBRL(7))).toBe("R$ 7,00");
  });
});

describe("formatDate", () => {
  it("formata um objeto Date como DD/MM/AAAA", () => {
    expect(formatDate(new Date(2026, 6, 6))).toBe("06/07/2026");
  });

  it("formata uma string 'YYYY-MM-DD' sem voltar um dia", () => {
    // É o ponto crítico: uma data pura passa por `parseLocalDate`, senão o
    // dia 6 apareceria como 05/07 no fuso de Brasília.
    expect(formatDate("2026-07-06")).toBe("06/07/2026");
  });

  it("formata uma string ISO completa usando o instante informado", () => {
    // 03:00Z = meia-noite em Brasília, ainda dia 6.
    expect(formatDate("2026-07-06T03:00:00.000Z")).toBe("06/07/2026");
  });

  it("respeita o fuso numa string ISO que cai no dia anterior localmente", () => {
    // 02:00Z = 23h do dia 5 em Brasília.
    expect(formatDate("2026-07-06T02:00:00.000Z")).toBe("05/07/2026");
  });

  it("preenche dia e mês com zero à esquerda", () => {
    expect(formatDate("2026-01-02")).toBe("02/01/2026");
  });
});

describe("monthLabel", () => {
  it("converte 'YYYY-MM' para mês e ano em português", () => {
    expect(monthLabel("2026-08")).toBe("agosto de 2026");
  });

  it("funciona em janeiro e em dezembro (limites do array de meses)", () => {
    expect(monthLabel("2026-01")).toBe("janeiro de 2026");
    expect(monthLabel("2026-12")).toBe("dezembro de 2026");
  });

  it("funciona com um ano diferente do atual", () => {
    expect(monthLabel("1999-03")).toBe("março de 1999");
  });
});
