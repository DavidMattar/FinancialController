// Três cartões de resumo (total gasto, quantidade de transações, ticket médio)
// exibidos no topo do dashboard/relatórios. Os valores já vêm calculados de fora;
// este componente só formata e exibe.
import { formatBRL } from "@/lib/format";

interface Props {
  totalExpense: number;
  transactionCount: number;
  averageTicket: number;
}

export default function SummaryCards({ totalExpense, transactionCount, averageTicket }: Props) {
  // Monta a lista de cards a partir das props já formatadas em Real (BRL).
  const cards = [
    { label: "Total gasto no período", value: formatBRL(totalExpense) },
    { label: "Transações", value: String(transactionCount) },
    { label: "Ticket médio", value: formatBRL(averageTicket) },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4"
        >
          <p className="text-sm text-slate-500 dark:text-slate-400">{card.label}</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-1">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
