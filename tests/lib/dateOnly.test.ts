import { describe, expect, it } from "vitest";
import { addDays, formatLocalDate, parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";

/**
 * Estas funções existem para evitar UM bug específico: `new Date("2026-07-06")`
 * é interpretado como meia-noite em UTC, que no horário de Brasília (UTC-3) é
 * 5 de julho às 21h — ou seja, a data "volta" um dia. Por isso o teste mais
 * importante aqui é justamente o que compara com o construtor nativo.
 */
describe("parseLocalDate", () => {
  it("interpreta 'YYYY-MM-DD' como meia-noite no horário local", () => {
    const d = parseLocalDate("2026-07-06");
    expect(d.getFullYear()).toBe(2026);
    // getMonth é 0-indexado: 6 = julho.
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("NÃO volta um dia, diferente do new Date() nativo (o bug que motivou o módulo)", () => {
    const nativo = new Date("2026-07-06");
    const nosso = parseLocalDate("2026-07-06");
    // O nativo cai no dia 5 no fuso de Brasília; o nosso mantém o dia 6.
    expect(nativo.getDate()).toBe(5);
    expect(nosso.getDate()).toBe(6);
  });

  it("ignora o que vier depois dos 10 primeiros caracteres (ISO completo)", () => {
    const d = parseLocalDate("2026-07-06T23:30:00.000Z");
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
  });

  it("preserva o dia 1º e o último dia do mês", () => {
    expect(parseLocalDate("2026-01-01").getDate()).toBe(1);
    const fim = parseLocalDate("2026-12-31");
    expect(fim.getMonth()).toBe(11);
    expect(fim.getDate()).toBe(31);
  });

  it("lida com 29 de fevereiro de ano bissexto", () => {
    const d = parseLocalDate("2028-02-29");
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });
});

describe("parseLocalDateEndOfDay", () => {
  it("retorna o último instante do dia informado", () => {
    const d = parseLocalDateEndOfDay("2026-07-06");
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it("é sempre posterior ao início do mesmo dia", () => {
    const inicio = parseLocalDate("2026-07-06");
    const fim = parseLocalDateEndOfDay("2026-07-06");
    expect(fim.getTime()).toBeGreaterThan(inicio.getTime());
    // Um dia inteiro menos 1ms.
    expect(fim.getTime() - inicio.getTime()).toBe(86_400_000 - 1);
  });
});

describe("addDays", () => {
  it("soma dias", () => {
    const d = addDays(parseLocalDate("2026-07-06"), 3);
    expect(d.getDate()).toBe(9);
  });

  it("subtrai dias quando o valor é negativo", () => {
    const d = addDays(parseLocalDate("2026-07-06"), -6);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(30);
  });

  it("atravessa a virada de mês", () => {
    const d = addDays(parseLocalDate("2026-01-31"), 1);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(1);
  });

  it("atravessa a virada de ano", () => {
    const d = addDays(parseLocalDate("2026-12-31"), 1);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it("não modifica a data original (é imutável)", () => {
    const original = parseLocalDate("2026-07-06");
    const antes = original.getTime();
    addDays(original, 10);
    expect(original.getTime()).toBe(antes);
  });

  it("somar 0 devolve uma cópia com o mesmo instante", () => {
    const original = parseLocalDate("2026-07-06");
    const copia = addDays(original, 0);
    expect(copia.getTime()).toBe(original.getTime());
    expect(copia).not.toBe(original);
  });

  it("atravessa o horário de verão sem perder o dia", () => {
    // Brasil não tem mais horário de verão, mas a data usada aqui era uma
    // virada histórica — garante que a soma é por dia de calendário.
    const d = addDays(parseLocalDate("2017-10-14"), 1);
    expect(d.getDate()).toBe(15);
    expect(d.getMonth()).toBe(9);
  });
});

describe("formatLocalDate", () => {
  it("formata a data em YYYY-MM-DD", () => {
    expect(formatLocalDate(new Date(2026, 7, 31))).toBe("2026-08-31");
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(formatLocalDate(new Date(2026, 0, 2))).toBe("2026-01-02");
  });

  it("é o caminho de volta de parseLocalDate", () => {
    expect(formatLocalDate(parseLocalDate("2026-02-28"))).toBe("2026-02-28");
  });

  it("usa o dia LOCAL, não o dia em UTC", () => {
    // 31/12 às 22h no Brasil (UTC-3) já é 01/01 em UTC: `toISOString()`
    // devolveria o ano seguinte.
    expect(formatLocalDate(new Date(2026, 11, 31, 22, 0))).toBe("2026-12-31");
  });
});
