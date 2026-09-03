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
 *
 * A lista de lançamentos é EDITÁVEL aqui (categoria, data, descrição, valor e
 * excluir), com uma exceção: as receitas da categoria "Aluguel Rancho" são
 * somente leitura, porque são criadas e atualizadas pelo próprio aluguel de
 * temporada (ver `isReceitaEditavel`).
 */
import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import TransactionsTable from "@/components/TransactionsTable";
import SeasonalRentalsSection from "@/components/SeasonalRentalsSection";
import { monthRange } from "@/lib/dateRanges";
import { formatBRL } from "@/lib/format";
import { RENTAL_INCOME_CATEGORY_NAME } from "@/lib/seasonalRentals";
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

/**
 * Se a receita pode ser editada/excluída nesta tela.
 *
 * A receita da categoria "Aluguel Rancho" é a transação auto-criada por um
 * aluguel de temporada: o valor dela É o "Total David" calculado pelo aluguel,
 * e editar o aluguel já reescreve valor, data e descrição dessa linha. Deixar
 * o ledger mexer nela daria dois donos para o mesmo número — e o aluguel
 * ganharia na próxima edição, apagando o que foi digitado aqui sem aviso.
 * Excluir seria pior: o aluguel ficaria com `transactionId` órfão e a receita
 * dele desapareceria do mês.
 *
 * A linha continua LISTADA (é receita do mês e entra nos 15/10/75 como
 * qualquer outra), só não aceita edição. Quem manda nela é o botão "editar" do
 * próprio aluguel, na seção de Aluguéis de Temporada logo abaixo.
 *
 * O teste é pelo NOME da categoria, e não pelo `source: "IMPORT"`, porque
 * fatura de cartão e NFC-e também são importadas e não têm nada a ver com
 * isso — e é o mesmo nome que a rota de aluguéis usa para achar a categoria.
 */
function isReceitaEditavel(transaction: Transaction): boolean {
  return transaction.category?.name !== RENTAL_INCOME_CATEGORY_NAME;
}

export default function ReceitasPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // Mês/ano escolhidos nos seletores do título — começam no mês corrente.
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [year, setYear] = useState(() => new Date().getFullYear());
  // Id da receita selecionada para exclusão, aguardando confirmação no
  // ConfirmDialog. Guarda o ID, e não a transação inteira, para a receita do
  // diálogo sair sempre da lista que está na tela: se a linha desaparecer num
  // recarregamento, o diálogo se fecha junto em vez de confirmar a exclusão de
  // algo que já não está mais ali.
  const [idToDelete, setIdToDelete] = useState<string | null>(null);

  const range = monthRange(year, month);
  const toDelete = transactions.find((t) => t.id === idToDelete) ?? null;

  /**
   * Busca em paralelo: as receitas do mês escolhido, a lista de categorias e o
   * resumo de orçamento (15/10/75) DESSE mesmo mês — o resumo é parametrizado
   * pelo período, então trocar o seletor troca os quatro cards junto com a
   * lista de lançamentos.
   */
  const load = useCallback(async (silent = false) => {
    // `silent` é o recarregamento de depois de uma edição: sem ligar o
    // `loading`, a tabela não é trocada por "Carregando..." e o campo que
    // acabou de ser editado não é remontado a cada Enter (é o mesmo incômodo
    // que /transacoes resolveu atualizando só a linha editada — aqui a
    // releitura inteira é necessária mesmo, porque os quatro cards do
    // orçamento saem da mesma receita, então o que se evita é só o pisca).
    if (!silent) setLoading(true);
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

  /**
   * Grava uma edição de receita e relê a tela.
   *
   * A releitura é da tela INTEIRA (lançamentos + resumo), e não só da linha
   * editada como em /transacoes: mudar valor ou data de uma receita muda o
   * total do mês e, com ele, os quatro cards do 15/10/75. E uma data movida
   * para fora do mês escolhido tem que fazer a linha sair da lista — a
   * releitura já entrega isso sem precisar de um espelho dos filtros no
   * navegador.
   */
  async function patchTransaction(id: string, body: Record<string, unknown>) {
    await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load(true);
  }

  /**
   * Confirma a exclusão pendente. Diferente de /transacoes (que usa o
   * `window.confirm` nativo), aqui o aviso é o `ConfirmDialog` do app, com a
   * descrição e o valor na mensagem: a lista de receitas costuma ter linhas de
   * descrição parecida ("Salário", "Salário 13"), e apagar a errada só se
   * descobre pelo total do mês mudando.
   */
  async function handleConfirmDelete() {
    // Guard de tipo: o diálogo só é montado com uma receita selecionada.
    /* v8 ignore next */
    if (!toDelete) return;
    await fetch(`/api/transactions/${toDelete.id}`, { method: "DELETE" });
    setIdToDelete(null);
    load(true);
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
            onCategoryChange={(id, categoryId) => patchTransaction(id, { categoryId })}
            onDateChange={(id, date) => patchTransaction(id, { date })}
            onDescriptionChange={(id, description) => patchTransaction(id, { description })}
            onAmountChange={(id, amount) => patchTransaction(id, { amount })}
            onDelete={setIdToDelete}
            isRowEditable={isReceitaEditavel}
          />
        )}
      </div>

      <SeasonalRentalsSection />

      <ConfirmDialog
        open={toDelete !== null}
        title="Excluir receita"
        message={
          toDelete
            ? `Excluir "${toDelete.description}" de ${formatBRL(Number(toDelete.amount))}?\n\nO total de receitas do mês e a divisão 15/10/75 são recalculados sem ela.`
            : ""
        }
        confirmLabel="Excluir"
        onConfirm={handleConfirmDelete}
        onCancel={() => setIdToDelete(null)}
      />
    </div>
  );
}
