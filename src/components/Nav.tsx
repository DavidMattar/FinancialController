"use client";

// Barra de navegação fixa no topo de todas as páginas: mostra o nome do app,
// os links das seções e o botão de alternar tema claro/escuro.

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { APP_TABS } from "@/lib/appTabs";

// A lista de abas vive em src/lib/appTabs.ts, e não aqui, porque o nome de cada
// aba também nomeia o arquivo de log dela (logs/AAAA-MM-DD/<slug>.log). Duas
// listas paralelas divergiriam na primeira aba nova.
const LINKS = APP_TABS;

export default function Nav() {
  // Rota atual, usada para destacar (highlight) o link da página em que o usuário está.
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center gap-8 h-14">
        <span className="font-semibold text-slate-900 whitespace-nowrap dark:text-slate-100">
          💰 Controle Financeiro
        </span>
        <nav className="flex gap-1 overflow-x-auto">
          {LINKS.map((link) => {
            // Um link é "ativo" quando sua rota é exatamente a página atual.
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
