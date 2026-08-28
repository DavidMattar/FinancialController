"use client";

// Componente genérico e reutilizável de "seção que pode ser recolhida/expandida",
// usado em várias partes do app (ex: seção de aluguéis de temporada, transações
// família, etc.) para agrupar conteúdo com um cabeçalho clicável.

import { useState, type ReactNode } from "react";

interface Props {
  /** Título exibido no cabeçalho da seção. */
  title: string;
  /** Texto secundário opcional, abaixo do título. */
  subtitle?: string;
  /** Se a seção começa aberta ou fechada (padrão: aberta). */
  defaultOpen?: boolean;
  /** Elemento (ex: botões) exibido à direita do cabeçalho, fora da área que recolhe/expande. */
  headerAction?: ReactNode;
  /** Conteúdo exibido quando a seção está aberta. */
  children: ReactNode;
}

export default function CollapsibleSection({ title, subtitle, defaultOpen = true, headerAction, children }: Props) {
  // Controla se o conteúdo da seção está visível.
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <span className={`text-slate-400 dark:text-slate-500 transition-transform ${open ? "rotate-90" : ""}`}>
            ›
          </span>
          <div className="min-w-0">
            <h2 className="font-medium text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
        </button>
        {/* stopPropagation: impede que um clique num botão do headerAction também
            acione o onClick do botão de recolher/expandir, já que ele está "por cima". */}
        {headerAction && <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>}
      </div>
      {open && <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-700 pt-4">{children}</div>}
    </div>
  );
}
