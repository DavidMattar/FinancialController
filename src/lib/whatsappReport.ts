import { formatBRL, formatDate } from "./format";

interface RentalExpense {
  description: string;
  amount: number;
}

interface RentalForReport {
  platform: "AIRBNB" | "BOOKING";
  checkIn: string;
  checkOut: string;
  netAmountReceived: number;
  cleaningFee: number;
  expenses: RentalExpense[];
  computed: {
    nights: number;
    tableValue: number;
    davidTenPercent: number;
    extraTableValue: number;
    totalDavid: number;
    netForDistribution: number;
  };
}

const PLATFORM_LABEL: Record<RentalForReport["platform"], string> = {
  AIRBNB: "Airbnb",
  BOOKING: "Booking",
};

/**
 * Monta o texto de um relatório de aluguel pronto para copiar e colar no
 * WhatsApp. Usa a formatação de negrito do próprio WhatsApp (`*texto*` vira
 * texto em negrito no app) para destacar títulos e os dois valores finais
 * ("Total David" e "Valor líquido para distribuição"). É gerado por aluguel
 * individual — não existe (por pedido do usuário) uma versão que junta
 * vários aluguéis de um período em um único relatório.
 */
export function buildSingleRentalWhatsAppReport(r: RentalForReport): string {
  const lines: string[] = [];
  lines.push("*Relatório de Aluguel de Temporada*");
  lines.push("");
  lines.push(`*${PLATFORM_LABEL[r.platform]}* — ${formatDate(r.checkIn)} a ${formatDate(r.checkOut)} (${r.computed.nights} noites)`);
  lines.push("");
  lines.push(`Valor líquido recebido: ${formatBRL(r.netAmountReceived)}`);
  lines.push(`10% do David: ${formatBRL(r.computed.davidTenPercent)}`);
  lines.push(`Limpeza: ${formatBRL(r.cleaningFee)}`);
  lines.push(`Valor de tabela: ${formatBRL(r.computed.tableValue)}`);
  lines.push(`Valor extra de tabela: ${formatBRL(r.computed.extraTableValue)}`);

  if (r.expenses.length > 0) {
    lines.push("");
    lines.push("Gastos extras:");
    for (const e of r.expenses) {
      lines.push(`• ${e.description}: ${formatBRL(e.amount)}`);
    }
  }

  lines.push("");
  lines.push(`*Total David: ${formatBRL(r.computed.totalDavid)}*`);
  lines.push(`*Valor líquido para distribuição: ${formatBRL(r.computed.netForDistribution)}*`);

  return lines.join("\n");
}
