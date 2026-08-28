"use client";

// Gráfico de rosca (donut) com a distribuição de gastos por categoria, usado no dashboard e relatórios.

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatBRL } from "@/lib/format";
import { useIsDark } from "@/lib/useIsDark";

// Uma "fatia" do gráfico: nome e cor da categoria, mais o total gasto nela.
export interface CategorySlice {
  name: string;
  color: string;
  total: number;
}

interface Props {
  data: CategorySlice[];
  emptyMessage?: string;
}

export default function CategoryPieChart({ data, emptyMessage = "Sem despesas no período selecionado." }: Props) {
  // Necessário porque o recharts não herda cores do Tailwind (ver mesmo motivo em MonthlyTrendChart).
  const isDark = useIsDark();

  if (data.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>;
  }

  return (
    <div className="text-slate-700 dark:text-slate-300">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={data} dataKey="total" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => formatBRL(Number(value))}
            contentStyle={{
              backgroundColor: isDark ? "#1e293b" : "#ffffff",
              borderColor: isDark ? "#334155" : "#e2e8f0",
              color: isDark ? "#e2e8f0" : "#0f172a",
            }}
            labelStyle={{ color: isDark ? "#e2e8f0" : "#0f172a" }}
          />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
