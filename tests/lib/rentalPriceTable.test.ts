import { describe, expect, it } from "vitest";
import {
  CLEANING_FEE_FIXED,
  computeNightRates,
  computeTableValue,
  nightKey,
  nightsBetween,
  sanitizeNightRateOverrides,
  suggestCleaningFee,
} from "@/lib/rentalPriceTable";

/**
 * Referências de calendário usadas nestes testes (2026), para as datas não
 * parecerem arbitrárias:
 * - 01/01/2026 é quinta-feira.
 * - Páscoa 2026 = 05/04. Logo: Carnaval 16 e 17/02, Sexta-feira Santa 03/04,
 *   Corpus Christi 04/06 (quinta).
 * - 08/06/2026 é segunda, 12/06 é sexta (baixa temporada, longe de feriado).
 * - 20/01/2026 é terça, 23/01 é sexta (alta temporada, longe de feriado).
 *
 * Tarifas da tabela: alta 200 (semana) / 300 (fim de semana); baixa 140 / 180;
 * feriado 350. "Noite de fim de semana" é a que COMEÇA sexta, sábado ou domingo.
 */
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("nightsBetween", () => {
  it("conta noites, não dias corridos", () => {
    expect(nightsBetween(d(2026, 6, 8), d(2026, 6, 11))).toBe(3);
  });

  it("devolve 0 quando check-in e check-out são o mesmo dia", () => {
    expect(nightsBetween(d(2026, 6, 8), d(2026, 6, 8))).toBe(0);
  });

  it("devolve negativo quando o check-out é antes do check-in", () => {
    expect(nightsBetween(d(2026, 6, 11), d(2026, 6, 8))).toBe(-3);
  });

  it("conta corretamente atravessando meses e anos", () => {
    expect(nightsBetween(d(2026, 1, 30), d(2026, 2, 2))).toBe(3);
    expect(nightsBetween(d(2026, 12, 30), d(2027, 1, 2))).toBe(3);
  });

  it("arredonda em vez de truncar (protege de resíduo de horário)", () => {
    // Check-in com horário diferente do check-out não deve virar 2 noites.
    const checkIn = new Date(2026, 5, 8, 14, 0, 0);
    const checkOut = new Date(2026, 5, 11, 11, 0, 0);
    expect(nightsBetween(checkIn, checkOut)).toBe(3);
  });
});

describe("nightKey", () => {
  it("formata como YYYY-MM-DD em horário local", () => {
    expect(nightKey(d(2026, 6, 8))).toBe("2026-06-08");
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(nightKey(d(2026, 1, 2))).toBe("2026-01-02");
  });

  it("usa a data local, não a UTC (não volta um dia)", () => {
    // 23h no fuso de Brasília ainda é o mesmo dia local, mas já é o dia
    // seguinte em UTC — a chave precisa seguir o local.
    expect(nightKey(new Date(2026, 5, 8, 23, 30, 0))).toBe("2026-06-08");
  });
});

describe("computeNightRates — tarifas da tabela", () => {
  it("baixa temporada, noite de dia de semana: 140", () => {
    const [noite] = computeNightRates(d(2026, 6, 8), d(2026, 6, 9));
    expect(noite.kind).toBe("LOW_SEASON");
    expect(noite.isWeekend).toBe(false);
    expect(noite.tableRate).toBe(140);
    expect(noite.rate).toBe(140);
    expect(noite.isOverridden).toBe(false);
  });

  it("baixa temporada, noite de fim de semana: 180", () => {
    const [noite] = computeNightRates(d(2026, 6, 12), d(2026, 6, 13));
    expect(noite.kind).toBe("LOW_SEASON");
    expect(noite.isWeekend).toBe(true);
    expect(noite.tableRate).toBe(180);
  });

  it("trata sexta, sábado E domingo como noite de fim de semana", () => {
    const noites = computeNightRates(d(2026, 6, 12), d(2026, 6, 15));
    expect(noites.map((n) => n.isWeekend)).toEqual([true, true, true]);
    expect(noites.map((n) => n.tableRate)).toEqual([180, 180, 180]);
  });

  it("alta temporada, noite de dia de semana: 200", () => {
    const [noite] = computeNightRates(d(2026, 1, 20), d(2026, 1, 21));
    expect(noite.kind).toBe("HIGH_SEASON");
    expect(noite.tableRate).toBe(200);
  });

  it("alta temporada, noite de fim de semana: 300", () => {
    const [noite] = computeNightRates(d(2026, 1, 23), d(2026, 1, 24));
    expect(noite.kind).toBe("HIGH_SEASON");
    expect(noite.isWeekend).toBe(true);
    expect(noite.tableRate).toBe(300);
  });
});

describe("computeNightRates — limites da alta temporada (15/dez a 15/fev)", () => {
  it("14/12 ainda é baixa temporada e 15/12 já é alta", () => {
    // 14/12/2026 = segunda, 15/12 = terça (ambos dia de semana).
    expect(computeNightRates(d(2026, 12, 14), d(2026, 12, 15))[0]).toMatchObject({
      kind: "LOW_SEASON",
      tableRate: 140,
    });
    expect(computeNightRates(d(2026, 12, 15), d(2026, 12, 16))[0]).toMatchObject({
      kind: "HIGH_SEASON",
      tableRate: 200,
    });
  });

  it("janeiro inteiro é alta temporada", () => {
    expect(computeNightRates(d(2026, 1, 20), d(2026, 1, 21))[0].kind).toBe("HIGH_SEASON");
    expect(computeNightRates(d(2026, 1, 28), d(2026, 1, 29))[0].kind).toBe("HIGH_SEASON");
  });

  it("15/02 é o último dia de alta temporada e 16/02 já é baixa", () => {
    // Usa 2027 de propósito: em 2026 o Carnaval cai em 16/17 de fevereiro e a
    // emenda dele cobriria o dia 15, escondendo a regra de temporada. Em 2027
    // o Carnaval é em 08/09 de fevereiro, então 15 e 16/02 (segunda e terça)
    // ficam limpos de feriado.
    expect(computeNightRates(d(2027, 2, 15), d(2027, 2, 16))[0]).toMatchObject({
      kind: "HIGH_SEASON",
      tableRate: 200,
    });
    expect(computeNightRates(d(2027, 2, 16), d(2027, 2, 17))[0]).toMatchObject({
      kind: "LOW_SEASON",
      tableRate: 140,
    });
  });

  it("22/02/2026 é baixa temporada (fora da alta e fora da emenda do Carnaval)", () => {
    // Domingo: 180.
    expect(computeNightRates(d(2026, 2, 22), d(2026, 2, 23))[0]).toMatchObject({
      kind: "LOW_SEASON",
      tableRate: 180,
    });
  });
});

describe("computeNightRates — feriados e emendas", () => {
  it("feriado em sexta cobra só a própria noite (sem regra de emenda na tabela)", () => {
    // 25/12/2026 = sexta.
    const noites = computeNightRates(d(2026, 12, 24), d(2026, 12, 27));
    expect(noites.map((n) => [nightKey(n.date), n.kind, n.tableRate])).toEqual([
      ["2026-12-24", "HIGH_SEASON", 200],
      ["2026-12-25", "HOLIDAY", 350],
      ["2026-12-26", "HIGH_SEASON", 300],
    ]);
  });

  it("feriado na segunda emenda 6 noites (segunda a sábado)", () => {
    // Carnaval (segunda) = 16/02/2026.
    const noites = computeNightRates(d(2026, 2, 16), d(2026, 2, 23));
    const feriados = noites.filter((n) => n.kind === "HOLIDAY").map((n) => n.key);
    expect(feriados).toEqual([
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
      "2026-02-20",
      "2026-02-21",
    ]);
    // A 7ª noite (domingo 22/02) já sai da emenda.
    expect(noites[6]).toMatchObject({ key: "2026-02-22", kind: "LOW_SEASON" });
  });

  it("feriado na terça emenda as 4 noites ANTERIORES (sexta a segunda)", () => {
    // Carnaval (terça) = 17/02/2026: a emenda vai de 13/02 (sexta) a 16/02.
    const noites = computeNightRates(d(2026, 2, 13), d(2026, 2, 17));
    expect(noites.map((n) => [n.key, n.kind])).toEqual([
      ["2026-02-13", "HOLIDAY"],
      ["2026-02-14", "HOLIDAY"],
      ["2026-02-15", "HOLIDAY"],
      ["2026-02-16", "HOLIDAY"],
    ]);
    expect(noites.every((n) => n.tableRate === 350)).toBe(true);
  });

  it("feriado na quinta emenda de quarta a sábado", () => {
    // Corpus Christi = 04/06/2026 (quinta).
    const noites = computeNightRates(d(2026, 6, 2), d(2026, 6, 8));
    expect(noites.map((n) => [n.key, n.kind])).toEqual([
      ["2026-06-02", "LOW_SEASON"],
      ["2026-06-03", "HOLIDAY"],
      ["2026-06-04", "HOLIDAY"],
      ["2026-06-05", "HOLIDAY"],
      ["2026-06-06", "HOLIDAY"],
      ["2026-06-07", "LOW_SEASON"],
    ]);
  });

  it("reconhece todos os feriados nacionais de data fixa", () => {
    // Cada feriado precisa gerar noites com tarifa de feriado em algum ponto
    // da janela ao redor dele. A janela é necessária porque a emenda depende
    // do dia da semana: num feriado de terça, por exemplo, as noites
    // cobradas são as ANTERIORES ao feriado (ver o teste da regra de terça).
    const fixos: [number, number, string][] = [
      [1, 1, "Confraternização Universal"],
      [4, 21, "Tiradentes"],
      [5, 1, "Dia do Trabalho"],
      [9, 7, "Independência"],
      [10, 12, "Nossa Senhora Aparecida"],
      [11, 2, "Finados"],
      [11, 15, "Proclamação da República"],
      [11, 20, "Consciência Negra"],
      [12, 25, "Natal"],
    ];
    for (const [mes, dia, nome] of fixos) {
      const inicio = new Date(2026, mes - 1, dia - 4);
      const fim = new Date(2026, mes - 1, dia + 4);
      const feriados = computeNightRates(inicio, fim).filter((n) => n.kind === "HOLIDAY");
      expect(feriados.length, `${nome} (${dia}/${mes}) não gerou noite de feriado`).toBeGreaterThan(0);
      expect(feriados.every((n) => n.tableRate === 350)).toBe(true);
    }
  });

  it("num feriado de terça, a própria noite do feriado NÃO é cobrada como feriado", () => {
    // Comportamento real da tabela, e não um bug: a janela de emenda descrita
    // na tabela para feriado de terça é "sexta a segunda, saída na terça".
    // Tiradentes 2026 (21/04) cai numa terça — a noite de 21/04 já é a da
    // saída, então volta para a tarifa normal de baixa temporada.
    const noites = computeNightRates(d(2026, 4, 17), d(2026, 4, 22));
    expect(noites.map((n) => [n.key, n.kind])).toEqual([
      ["2026-04-17", "HOLIDAY"],
      ["2026-04-18", "HOLIDAY"],
      ["2026-04-19", "HOLIDAY"],
      ["2026-04-20", "HOLIDAY"],
      ["2026-04-21", "LOW_SEASON"],
    ]);
  });

  it("reconhece os feriados derivados da Páscoa (Sexta-feira Santa de 2025)", () => {
    // Páscoa 2025 = 20/04, então Sexta-feira Santa = 18/04/2025 (sexta).
    const [noite] = computeNightRates(d(2025, 4, 18), d(2025, 4, 19));
    expect(noite.kind).toBe("HOLIDAY");
  });

  it("Consciência Negra só vale como feriado a partir de 2024", () => {
    // 20/11/2023 = segunda; ainda não era feriado nacional.
    expect(computeNightRates(d(2023, 11, 20), d(2023, 11, 21))[0]).toMatchObject({
      kind: "LOW_SEASON",
      tableRate: 140,
    });
    // 20/11/2024 = quarta; já é feriado nacional.
    expect(computeNightRates(d(2024, 11, 20), d(2024, 11, 21))[0]).toMatchObject({
      kind: "HOLIDAY",
      tableRate: 350,
    });
  });

  it("considera feriado do ano seguinte numa estadia que vira o ano", () => {
    // 01/01/2027 é sexta: feriado de uma noite só. A noite de 31/12/2026
    // (quinta) fica na alta temporada, sem emenda.
    const noites = computeNightRates(d(2026, 12, 31), d(2027, 1, 2));
    expect(noites.map((n) => [n.key, n.kind])).toEqual([
      ["2026-12-31", "HIGH_SEASON"],
      ["2027-01-01", "HOLIDAY"],
    ]);
  });
});

describe("computeNightRates — estadia sem noites", () => {
  it("devolve lista vazia quando check-in e check-out são iguais", () => {
    expect(computeNightRates(d(2026, 6, 8), d(2026, 6, 8))).toEqual([]);
  });

  it("devolve lista vazia quando o check-out é antes do check-in", () => {
    expect(computeNightRates(d(2026, 6, 11), d(2026, 6, 8))).toEqual([]);
  });
});

describe("computeNightRates — diárias customizadas (overrides)", () => {
  it("substitui a tarifa só da noite informada e mantém tableRate visível", () => {
    const noites = computeNightRates(d(2026, 6, 8), d(2026, 6, 11), {
      "2026-06-09": 250,
    });
    expect(noites.map((n) => n.rate)).toEqual([140, 250, 140]);
    // A tarifa original continua exposta para a tela poder oferecer "restaurar".
    expect(noites.map((n) => n.tableRate)).toEqual([140, 140, 140]);
    expect(noites.map((n) => n.isOverridden)).toEqual([false, true, false]);
  });

  it("aceita override de valor zero (diária de graça)", () => {
    const [noite] = computeNightRates(d(2026, 6, 8), d(2026, 6, 9), { "2026-06-08": 0 });
    expect(noite.rate).toBe(0);
    expect(noite.isOverridden).toBe(true);
  });

  it("substitui até a tarifa de feriado", () => {
    const [noite] = computeNightRates(d(2026, 12, 25), d(2026, 12, 26), {
      "2026-12-25": 500,
    });
    expect(noite.kind).toBe("HOLIDAY");
    expect(noite.tableRate).toBe(350);
    expect(noite.rate).toBe(500);
  });

  it("ignora chave que não corresponde a nenhuma noite da estadia", () => {
    const noites = computeNightRates(d(2026, 6, 8), d(2026, 6, 10), {
      "2026-12-31": 999,
    });
    expect(noites.every((n) => !n.isOverridden)).toBe(true);
  });

  it("ignora override que não é número finito", () => {
    const noites = computeNightRates(d(2026, 6, 8), d(2026, 6, 10), {
      "2026-06-08": Number.NaN,
      "2026-06-09": Number.POSITIVE_INFINITY,
    });
    expect(noites.map((n) => n.isOverridden)).toEqual([false, false]);
    expect(noites.map((n) => n.rate)).toEqual([140, 140]);
  });

  it("funciona com overrides null ou undefined", () => {
    expect(computeNightRates(d(2026, 6, 8), d(2026, 6, 9), null)[0].rate).toBe(140);
    expect(computeNightRates(d(2026, 6, 8), d(2026, 6, 9), undefined)[0].rate).toBe(140);
    expect(computeNightRates(d(2026, 6, 8), d(2026, 6, 9))[0].rate).toBe(140);
  });
});

describe("computeTableValue", () => {
  it("é a soma das tarifas de cada noite", () => {
    // 08/06 (seg) a 11/06: 3 noites de dia de semana em baixa temporada.
    expect(computeTableValue(d(2026, 6, 8), d(2026, 6, 11))).toBe(420);
  });

  it("mistura dia de semana e fim de semana corretamente", () => {
    // 11/06 (qui) a 15/06: qui 140 + sex 180 + sáb 180 + dom 180 = 680.
    expect(computeTableValue(d(2026, 6, 11), d(2026, 6, 15))).toBe(680);
  });

  it("soma usando as diárias customizadas quando existem", () => {
    expect(
      computeTableValue(d(2026, 6, 8), d(2026, 6, 11), { "2026-06-09": 300 }),
    ).toBe(580);
  });

  it("devolve 0 para estadia sem noites", () => {
    expect(computeTableValue(d(2026, 6, 8), d(2026, 6, 8))).toBe(0);
  });
});

describe("sanitizeNightRateOverrides", () => {
  const checkIn = d(2026, 6, 8);
  const checkOut = d(2026, 6, 11); // noites: 08, 09, 10

  it("mantém só as noites que pertencem ao período", () => {
    const limpo = sanitizeNightRateOverrides(
      { "2026-06-08": 200, "2026-06-10": 250, "2026-06-11": 300, "2026-05-01": 100 },
      checkIn,
      checkOut,
    );
    // 11/06 é o dia do check-out (não é noite) e 01/05 está fora.
    expect(limpo).toEqual({ "2026-06-08": 200, "2026-06-10": 250 });
  });

  it("descarta valores não numéricos ou negativos", () => {
    const limpo = sanitizeNightRateOverrides(
      {
        "2026-06-08": Number.NaN,
        "2026-06-09": -50,
        "2026-06-10": 180,
      } as Record<string, number>,
      checkIn,
      checkOut,
    );
    expect(limpo).toEqual({ "2026-06-10": 180 });
  });

  it("mantém zero (é um valor válido de diária)", () => {
    expect(sanitizeNightRateOverrides({ "2026-06-08": 0 }, checkIn, checkOut)).toEqual({
      "2026-06-08": 0,
    });
  });

  it("converte string numérica para número", () => {
    const limpo = sanitizeNightRateOverrides(
      { "2026-06-08": "250" } as unknown as Record<string, number>,
      checkIn,
      checkOut,
    );
    expect(limpo).toEqual({ "2026-06-08": 250 });
  });

  it("devolve mapa vazio para null, undefined ou mapa vazio", () => {
    expect(sanitizeNightRateOverrides(null, checkIn, checkOut)).toEqual({});
    expect(sanitizeNightRateOverrides(undefined, checkIn, checkOut)).toEqual({});
    expect(sanitizeNightRateOverrides({}, checkIn, checkOut)).toEqual({});
  });

  it("devolve mapa vazio quando o período não tem nenhuma noite", () => {
    expect(sanitizeNightRateOverrides({ "2026-06-08": 200 }, checkIn, checkIn)).toEqual({});
  });

  it("é o que protege o banco quando o usuário muda as datas depois de customizar", () => {
    // Customizou 08 e 09 e depois mudou o check-in para 09: a noite 08 sai.
    const limpo = sanitizeNightRateOverrides(
      { "2026-06-08": 200, "2026-06-09": 210 },
      d(2026, 6, 9),
      d(2026, 6, 11),
    );
    expect(limpo).toEqual({ "2026-06-09": 210 });
  });
});

describe("taxa de limpeza", () => {
  it("o valor sugerido é a constante fixa", () => {
    expect(suggestCleaningFee()).toBe(CLEANING_FEE_FIXED);
    expect(CLEANING_FEE_FIXED).toBe(180);
  });
});
