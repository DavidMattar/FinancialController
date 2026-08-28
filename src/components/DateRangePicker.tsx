"use client";

// Seletor de período (data "de" / "até") usado nas páginas de relatórios e listagens,
// com botões de atalho para os intervalos mais comuns.

import { currentMonthRange, currentYearRange, lastMonthRange, lastNMonthsRange, type DateRange } from "@/lib/dateRanges";

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

// Atalhos de período pré-definidos: cada um sabe calcular seu próprio DateRange (ver src/lib/dateRanges.ts).
const PRESETS: { label: string; get: () => DateRange }[] = [
  { label: "Este mês", get: currentMonthRange },
  { label: "Mês passado", get: lastMonthRange },
  { label: "Últimos 3 meses", get: () => lastNMonthsRange(3) },
  { label: "Este ano", get: currentYearRange },
];

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.get())}
            className="px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2 py-1.5 [color-scheme:light] dark:[color-scheme:dark]"
        />
        <span className="text-slate-400 dark:text-slate-500">até</span>
        <input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-md px-2 py-1.5 [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>
    </div>
  );
}
