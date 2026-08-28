"use client";

// Gráfico de barras com o total gasto por mês (evolução mensal), usado nos relatórios.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/format";
import { useIsDark } from "@/lib/useIsDark";

// Um ponto do gráfico: o mês (rótulo já formatado) e o total gasto nele.
export interface MonthlyPoint {
  month: string;
  total: number;
}

export default function MonthlyTrendChart({ data }: { data: MonthlyPoint[] }) {
  // A biblioteca de gráficos (recharts) não lê o CSS/Tailwind da página, então
  // precisamos saber manualmente se o tema é escuro para escolher as cores certas.
  const isDark = useIsDark();

  if (data.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Sem dados suficientes.</p>;
  }

  // Cores dos eixos/grade ajustadas manualmente para tema claro/escuro (ver comentário acima).
  const tickColor = isDark ? "#94a3b8" : "#64748b";
  const gridColor = isDark ? "#334155" : "#e2e8f0";

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: tickColor }} />
        <YAxis tick={{ fontSize: 12, fill: tickColor }} tickFormatter={(v) => `R$${Math.round(v / 1000)}k`} />
        <Tooltip
          formatter={(value) => formatBRL(Number(value))}
          contentStyle={{
            backgroundColor: isDark ? "#1e293b" : "#ffffff",
            borderColor: isDark ? "#334155" : "#e2e8f0",
            color: isDark ? "#e2e8f0" : "#0f172a",
          }}
          labelStyle={{ color: isDark ? "#e2e8f0" : "#0f172a" }}
        />
        <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
