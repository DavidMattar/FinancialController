"use client";

/**
 * Página "/receitas" — mostra as receitas de UM mês e como elas se dividem
 * pela regra de orçamento 15/10/75 (15% livre para gastar, 10% dízimo, 75%
 * investimento), além da seção de aluguéis de temporada
 * (`SeasonalRentalsSection`).
 *
 * O mês exibido é escolhido pelo usuário nos dois seletores do próprio título
 * ("Receitas — [mês] de [ano]"), que começam no mês corrente. Antes o período
 * era fixo no mês atual; os seletores existem para consultar um mês passado
 * (ou já lançar o próximo) sem sair da tela. Todo o conteúdo da página segue
 * essa escolha: os lançamentos listados e os quatro cards do orçamento.
 */
import { useCallback, useEffect, useState } from "react";
import TransactionsTable from "@/components/TransactionsTable";
import SeasonalRentalsSection from "@/components/SeasonalRentalsSection";
import { monthRange } from "@/lib/dateRanges";
import { formatBRL } from "@/lib/format";
import type { BudgetSummary } from "@/lib/budget";
import type { Category, Transaction } from "@/lib/types";

/**
 * Os doze meses com o nome em português, calculados uma vez pelo `Intl` (em
 * vez de uma lista escrita à mão) para nunca divergirem do nome que o resto
 * do app já mostra em datas e títulos.
 */
const MESES = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date(2026, i, 1)),
}));

/** Quantos anos para trás e para frente o seletor de ano oferece. */
const ANOS_PARA_TRAS = 5;
const ANOS_PARA_FRENTE = 1;

/**
 * Anos oferecidos no seletor: uma janela em volta do ano corrente. É uma
 * janela fixa, e não a lista de anos que existem no banco, para a página não
 * precisar de uma consulta a mais só para montar um select — esticá-la é
 * mudar as duas constantes acima.
 */
function anosDisponiveis(anoAtual: number): number[] {
  const total = ANOS_PARA_TRAS + ANOS_PARA_FRENTE + 1;
  return Array.from({ length: total }, (_, i) => anoAtual - ANOS_PARA_TRAS + i);
}

export default function ReceitasPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Mês/ano escolhidos nos seletores do título — começam no mês corrente.
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [year, setYear] = useState(() => new Date().getFullYear());

  const range = monthRange(year, month);

  /**
   * Busca em paralelo: as receitas do mês escolhido, a lista de categorias e o
   * resumo de orçamento (15/10/75) DESSE mesmo mês — o resumo é parametrizado
   * pelo período, então trocar o seletor troca os quatro cards junto com a
   * lista de lançamentos.
   */
  const load = useCallback(async () => {
    setLoading(true);
    const [txRes, catRes, summaryRes] = await Promise.all([
      fetch(`/api/transactions?type=INCOME&from=${range.from}&to=${range.to}`),
      fetch("/api/categories"),
      fetch(`/api/budget/summary?from=${range.from}&to=${range.to}`),
    ]);
    setTransactions(await txRes.json());
    setCategories(await catRes.json());
    setSummary(await summaryRes.json());
    setLoading(false);
  }, [range.from, range.to]);

  // Recarrega a cada troca de mês/ano (o `load` só muda quando o período muda).
  useEffect(() => {
    load();
  }, [load]);

  /** Troca a categoria de uma receita e recarrega tudo (o resumo de orçamento pode mudar se a categoria afetar o cálculo). */
  async function handleCategoryChange(id: string, categoryId: string | null) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId }),
    });
    load();
  }

  const classeSeletor =
    "border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-md px-2 py-1 text-base font-normal";

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
        <span>Receitas —</span>
        {/* `aria-label` (em vez de um <label> irmão, padrão dos formulários do
            app) porque o rótulo visível aqui é a própria frase do título. */}
        <select
          aria-label="Mês"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className={classeSeletor}
        >
          {MESES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <span>de</span>
        <select
          aria-label="Ano"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className={classeSeletor}
        >
          {anosDisponiveis(new Date().getFullYear()).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </h1>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">Total de receitas no mês</p>
            <p className="text-2xl font-semibold mt-1 text-slate-900 dark:text-slate-100">
              {formatBRL(summary.totalIncome)}
            </p>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-xl p-4">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">15% Disponível para gastar</p>
            <p className="text-2xl font-semibold mt-1 text-emerald-800 dark:text-emerald-300">
              {formatBRL(summary.freeToSpend.available)}
            </p>
            <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
              de {formatBRL(summary.freeToSpend.allocated)} alocado
            </p>
          </div>
          <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 rounded-xl p-4">
            <p className="text-sm text-indigo-700 dark:text-indigo-400">10% Dízimo</p>
            <p className="text-2xl font-semibold mt-1 text-indigo-800 dark:text-indigo-300">
              {formatBRL(summary.tithe.amount)}
            </p>
          </div>
          <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded-xl p-4">
            <p className="text-sm text-sky-700 dark:text-sky-400">75% Investimento</p>
            <p className="text-2xl font-semibold mt-1 text-sky-800 dark:text-sky-300">
              {formatBRL(summary.investment.amount)}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <h2 className="font-medium mb-2 text-slate-900 dark:text-slate-100">Lançamentos de receita no mês</h2>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
        ) : (
          <TransactionsTable
            transactions={transactions}
            categories={categories}
            onCategoryChange={handleCategoryChange}
          />
        )}
      </div>

      <SeasonalRentalsSection />
    </div>
  );
}
