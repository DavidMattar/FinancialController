import { describe, expect, it } from "vitest";
import { buildSingleRentalWhatsAppReport } from "@/lib/whatsappReport";
import { normalizarEspacos } from "../helpers/text";

/**
 * O `Intl` separa "R$" do número com espaço não-quebrável (U+00A0), e o
 * caractere exato depende da versão do ICU do Node. Por isso a comparação
 * normaliza SEMPRE OS DOIS LADOS: assim o teste verifica o texto do relatório
 * e não qual caractere de espaço foi digitado no arquivo de teste.
 */
const norm = normalizarEspacos;
const contem = (texto: string, trecho: string) => norm(texto).includes(norm(trecho));

const base = {
  platform: "AIRBNB" as const,
  checkIn: "2026-06-08",
  checkOut: "2026-06-11",
  netAmountReceived: 1000,
  cleaningFee: 180,
  expenses: [] as { description: string; amount: number }[],
  computed: {
    nights: 3,
    tableValue: 420,
    davidTenPercent: 100,
    extraTableValue: 300,
    totalDavid: 250,
    netForDistribution: 570,
  },
};

describe("buildSingleRentalWhatsAppReport", () => {
  it("monta o relatório completo, com as datas em formato brasileiro", () => {
    const esperado = [
      "*Relatório de Aluguel de Temporada*",
      "",
      "*Airbnb* — 08/06/2026 a 11/06/2026 (3 noites)",
      "",
      "Valor líquido recebido: R$ 1.000,00",
      "10% do David: R$ 100,00",
      "Limpeza: R$ 180,00",
      "Valor de tabela: R$ 420,00",
      "Valor extra de tabela: R$ 300,00",
      "",
      "*Total David: R$ 250,00*",
      "*Valor líquido para distribuição: R$ 570,00*",
    ].join("\n");
    expect(norm(buildSingleRentalWhatsAppReport(base))).toBe(norm(esperado));
  });

  it("usa a formatação de negrito do WhatsApp nos dois valores finais", () => {
    const texto = buildSingleRentalWhatsAppReport(base);
    // `*texto*` é o que o WhatsApp renderiza como negrito.
    expect(contem(texto, "*Total David: R$ 250,00*")).toBe(true);
    expect(contem(texto, "*Valor líquido para distribuição: R$ 570,00*")).toBe(true);
    expect(texto.startsWith("*Relatório de Aluguel de Temporada*")).toBe(true);
  });

  it("traduz o rótulo da plataforma Booking", () => {
    const texto = buildSingleRentalWhatsAppReport({ ...base, platform: "BOOKING" });
    expect(contem(texto, "*Booking* —")).toBe(true);
    expect(texto).not.toContain("Airbnb");
  });

  it("lista os gastos extras quando existem", () => {
    const texto = buildSingleRentalWhatsAppReport({
      ...base,
      expenses: [
        { description: "Gás", amount: 60 },
        { description: "Faxina extra", amount: 40.5 },
      ],
    });
    expect(contem(texto, "Gastos extras:")).toBe(true);
    expect(contem(texto, "• Gás: R$ 60,00")).toBe(true);
    expect(contem(texto, "• Faxina extra: R$ 40,50")).toBe(true);
  });

  it("omite a seção de gastos extras quando a lista está vazia", () => {
    const texto = buildSingleRentalWhatsAppReport(base);
    expect(texto).not.toContain("Gastos extras");
    expect(texto).not.toContain("•");
  });

  it("mostra valor extra de tabela negativo (reserva abaixo da tabela)", () => {
    const texto = buildSingleRentalWhatsAppReport({
      ...base,
      netAmountReceived: 500,
      computed: {
        ...base.computed,
        davidTenPercent: 50,
        extraTableValue: -150,
        totalDavid: 50,
        netForDistribution: 270,
      },
    });
    expect(contem(texto, "Valor extra de tabela: -R$ 150,00")).toBe(true);
    expect(contem(texto, "*Total David: R$ 50,00*")).toBe(true);
  });

  it("aceita estadia de uma única noite", () => {
    const texto = buildSingleRentalWhatsAppReport({
      ...base,
      checkOut: "2026-06-09",
      computed: { ...base.computed, nights: 1 },
    });
    expect(contem(texto, "08/06/2026 a 09/06/2026 (1 noites)")).toBe(true);
  });

  it("aceita datas em ISO completo sem voltar um dia", () => {
    const texto = buildSingleRentalWhatsAppReport({
      ...base,
      checkIn: "2026-06-08T03:00:00.000Z",
      checkOut: "2026-06-11T03:00:00.000Z",
    });
    expect(contem(texto, "08/06/2026 a 11/06/2026")).toBe(true);
  });

  it("mantém a ordem das linhas do relatório", () => {
    const texto = norm(buildSingleRentalWhatsAppReport(base));
    const iRecebido = texto.indexOf("Valor líquido recebido");
    const iTabela = texto.indexOf("Valor de tabela");
    const iTotalDavid = texto.indexOf("*Total David");
    const iDistribuicao = texto.indexOf("*Valor líquido para distribuição");
    expect(iRecebido).toBeLessThan(iTabela);
    expect(iTabela).toBeLessThan(iTotalDavid);
    expect(iTotalDavid).toBeLessThan(iDistribuicao);
  });
});
