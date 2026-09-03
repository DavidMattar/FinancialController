"use client";

// Tabela de transações reutilizada em várias páginas (dashboard, transações, receitas).
// Cada linha pode ser expandida para mostrar o detalhamento interno (itens da compra)
// através do componente TransactionItemsPanel.
//
// A tabela é somente leitura por padrão: cada coluna editável (categoria, data,
// descrição, valor) e cada ação (excluir, mover para a família) só aparece se a
// tela passar o callback correspondente — é assim que o dashboard fica só de
// leitura sem precisar de um modo "readOnly". Em cima disso, `isRowEditable`
// permite bloquear a edição de LINHAS específicas numa tela que liberou as
// colunas (ver o prop, e a receita de aluguel em /receitas).

import { Fragment, useState } from "react";
import { toDateInputValue } from "@/lib/dateOnly";
import { parseDecimalInput } from "@/lib/decimalInput";
import { formatBRL, formatDate } from "@/lib/format";
import TransactionItemsPanel from "./TransactionItemsPanel";
import type { Category, Transaction } from "@/lib/types";

interface Props {
  transactions: Transaction[];
  categories: Category[];
  // Se informado, a coluna "categoria" vira um <select> editável em vez de só exibir o nome.
  onCategoryChange?: (transactionId: string, categoryId: string | null) => void;
  // Se informado, a coluna "data" vira um <input type="date"> editável; recebe a
  // data já no formato "YYYY-MM-DD" que a rota de PATCH espera.
  onDateChange?: (transactionId: string, date: string) => void;
  // Se informado, a coluna "descrição" vira um campo de texto editável.
  // Cada coluna tem seu próprio callback (em vez de um "onEdit" genérico) porque
  // é assim que a tabela já libera a categoria: cada tela permite só a edição que
  // faz sentido nela. Hoje /transacoes e /receitas editam; no dashboard a
  // tabela continua somente de leitura, porque ele não passa callback nenhum.
  onDescriptionChange?: (transactionId: string, description: string) => void;
  // Se informado, a coluna "valor" vira um campo editável. Recebe o valor já
  // como número (a célula passa o texto digitado por `parseDecimalInput`),
  // seguindo a convenção do app: quem digita texto livre converte antes de
  // mandar para a API.
  onAmountChange?: (transactionId: string, amount: number) => void;
  // Se informado, mostra uma coluna extra com o botão "excluir".
  onDelete?: (transactionId: string) => void;
  /**
   * Se informado, decide LINHA POR LINHA se as edições liberadas acima
   * (categoria, data, descrição, valor e excluir) valem para aquela transação.
   * Sem ele, todas as linhas são editáveis — que é o comportamento de
   * /transacoes.
   *
   * É um predicado só, e não um por coluna, porque a pergunta que ele responde
   * é uma só: "esta linha pertence a outro sistema?". É o caso da receita
   * auto-criada de um aluguel de temporada em /receitas — o valor dela é
   * calculado pelo aluguel, então quem manda nela é o modal do aluguel, não o
   * ledger. A linha continua aparecendo (ela é receita do mês, e some da tela
   * seria pior), só não aceita edição.
   */
  isRowEditable?: (transaction: Transaction) => boolean;
  onPendingReturnChange?: (transactionId: string, value: boolean) => void;
  // Se informado, cada linha ganha um botão "→ Família", que move a transação
  // para o ledger isolado da família. Só a página /transacoes passa esse
  // callback: mover é decisão do ledger principal, não da tela de receitas
  // (que edita as linhas dela, mas não as tira do lugar).
  // Recebe a transação inteira (e não só o id, como onDelete) porque o diálogo
  // de confirmação precisa da descrição e do tipo para montar o aviso.
  onMoveToFamily?: (transaction: Transaction) => void;
}

// Tradução dos valores do enum TransactionType (banco de dados) para rótulos em português.
const TYPE_LABEL: Record<Transaction["type"], string> = {
  EXPENSE: "Despesa",
  INCOME: "Crédito",
  PAYMENT: "Pagamento",
};

export default function TransactionsTable({
  transactions,
  categories,
  onCategoryChange,
  onDateChange,
  onDescriptionChange,
  onAmountChange,
  onDelete,
  onPendingReturnChange,
  onMoveToFamily,
  isRowEditable,
}: Props) {
  // Guarda o id da transação cuja linha de detalhamento está aberta (só uma por vez); null = nenhuma aberta.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (transactions.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-4">Nenhuma transação encontrada.</p>;
  }

  // O número de colunas da tabela muda conforme as colunas de ação presentes
  // (excluir e/ou mover para Família), e é usado no colSpan da linha de
  // detalhamento expandida para ela ocupar a largura toda.
  const columnCount = 6 + (onDelete ? 1 : 0) + (onMoveToFamily ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <th className="py-2 pr-4">Data</th>
            <th className="py-2 pr-4">Descrição</th>
            <th className="py-2 pr-4">Cartão</th>
            <th className="py-2 pr-4">Categoria</th>
            <th className="py-2 pr-4">Tipo</th>
            <th className="py-2 pr-4 text-right">Valor</th>
            {onMoveToFamily && <th className="py-2 pl-2" />}
            {onDelete && <th className="py-2 pl-2" />}
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const expanded = expandedId === t.id;
            // Uma linha só é editável se a TELA liberou a coluna (o callback) e
            // o predicado por linha não a bloqueou.
            const editable = isRowEditable ? isRowEditable(t) : true;
            const editCategory = onCategoryChange && editable ? onCategoryChange : undefined;
            const editDate = onDateChange && editable ? onDateChange : undefined;
            const editDescription = onDescriptionChange && editable ? onDescriptionChange : undefined;
            const editAmount = onAmountChange && editable ? onAmountChange : undefined;
            // "pendente de devolução": compra em e-commerce marcada manualmente para
            // acompanhamento (ex: aguardando estorno) — a linha fica destacada em vermelho.
            const pending = Boolean(t.pendingReturn);
            // O número da parcela aparece nos dois modos da célula de descrição
            // (somente leitura e editável), por isso fica numa variável só.
            const installmentLabel =
              t.installmentCurrent && t.installmentTotal ? (
                <span className="text-slate-400 dark:text-slate-500 text-xs whitespace-nowrap">
                  {" "}
                  ({t.installmentCurrent}/{t.installmentTotal})
                </span>
              ) : null;
            return (
              <Fragment key={t.id}>
                <tr
                  className={`border-b border-slate-100 dark:border-slate-700 ${
                    pending
                      ? "bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  }`}
                >
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {editDate ? (
                      <input
                        type="date"
                        value={toDateInputValue(t.date)}
                        aria-label={`Data de ${t.description}`}
                        // Grava direto na mudança, como o select de categoria: o
                        // <input type="date"> só dispara onChange com uma data
                        // completa, então não existe estado intermediário para
                        // segurar. Campo limpo ("") é ignorado — a transação
                        // precisa de uma data, e apagar não é uma edição válida.
                        onChange={(e) => {
                          if (e.target.value) editDate(t.id, e.target.value);
                        }}
                        className="border border-transparent hover:border-slate-200 focus:border-indigo-500 dark:hover:border-slate-600 rounded px-1.5 py-1 text-sm bg-transparent dark:text-slate-300 outline-none [color-scheme:light] dark:[color-scheme:dark]"
                      />
                    ) : (
                      formatDate(t.date)
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-xs">
                    {editDescription ? (
                      // No modo editável a descrição é um campo de texto, então a
                      // seta vira o único alvo de clique para expandir — a linha
                      // continua expansível sem que clicar no texto (para posicionar
                      // o cursor) feche o detalhamento.
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : t.id)}
                          title={`${t.description} — clique para ver o detalhamento`}
                          aria-label={`Ver detalhamento de ${t.description}`}
                          className={`text-slate-400 dark:text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}
                        >
                          ›
                        </button>
                        <DescriptionCell transaction={t} pending={pending} onSave={editDescription} />
                        {pending && <span title="Pendente de devolução">🔴</span>}
                        {installmentLabel}
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : t.id)}
                          className={`flex items-center gap-1.5 text-left truncate hover:underline ${
                            pending ? "text-red-700 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
                          }`}
                          title={`${t.description} — clique para ver o detalhamento`}
                        >
                          <span className={`text-slate-400 dark:text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}>
                            ›
                          </span>
                          <span className="truncate">{t.description}</span>
                          {pending && <span title="Pendente de devolução">🔴</span>}
                        </button>
                        {installmentLabel}
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {t.creditCard ? `****${t.creditCard.lastDigits}` : "—"}
                  </td>
                  <td className="py-2 pr-4">
                    {editCategory ? (
                      <select
                        value={t.categoryId ?? ""}
                        onChange={(e) => editCategory(t.id, e.target.value || null)}
                        className="border border-slate-200 dark:border-slate-600 rounded-md px-2 py-1 text-xs bg-white dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Sem categoria</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : t.category ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${t.category.color}1a`, color: t.category.color }}
                      >
                        {t.category.name}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 dark:text-slate-500">Sem categoria</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {TYPE_LABEL[t.type]}
                  </td>
                  <td
                    className={`py-2 pr-4 text-right whitespace-nowrap font-medium ${
                      pending
                        ? "text-red-700 dark:text-red-400"
                        : t.type === "EXPENSE"
                          ? "text-slate-900 dark:text-slate-100"
                          : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {editAmount ? (
                      <AmountCell transaction={t} onSave={editAmount} />
                    ) : (
                      <>
                        {t.type === "PAYMENT" ? "-" : ""}
                        {formatBRL(Number(t.amount))}
                      </>
                    )}
                  </td>
                  {onMoveToFamily && (
                    <td className="py-2 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => onMoveToFamily(t)}
                        title="Mover esta transação para o ledger de Transações Família"
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 text-xs whitespace-nowrap"
                      >
                        → Família
                      </button>
                    </td>
                  )}
                  {onDelete && (
                    <td className="py-2 pl-2 text-right">
                      {editable && (
                        <button
                          type="button"
                          onClick={() => onDelete(t.id)}
                          className="text-slate-400 hover:text-red-500 text-xs"
                        >
                          excluir
                        </button>
                      )}
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                    <td colSpan={columnCount}>
                      <TransactionItemsPanel
                        transactionId={t.id}
                        categoryId={t.categoryId ?? null}
                        transactionAmount={Number(t.amount)}
                        description={t.description}
                        hasCreditCard={Boolean(t.creditCardId)}
                        pendingReturn={pending}
                        onPendingReturnChange={onPendingReturnChange}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Célula da coluna "Descrição" no modo editável. Grava por PATCH ao sair do
 * campo (ou no Enter, que só tira o foco e cai no mesmo caminho), no mesmo
 * padrão da coluna "Descrição" de /investimentos — não há botão de salvar
 * porque o campo é texto livre, sem validação para reportar.
 *
 * O texto em edição vive em estado LOCAL, e não no `transaction` recebido: cada
 * gravação substitui a linha pela resposta do servidor, e ler do dado da página
 * faria essa resposta apagar o que está sendo digitado.
 *
 * Descrição em branco é REVERTIDA para a original, não gravada: a rota exige
 * `z.string().min(1)`, então devolver o texto anterior é mais honesto do que
 * mandar um valor que já se sabe que a API vai recusar. Gravar só quando o
 * texto realmente mudou também evita um PATCH a cada clique fora do campo.
 *
 * Renomear NÃO re-sugere categoria — a sugestão por `Category.keywords`
 * acontece na importação, e daí em diante a categoria é escolha explícita
 * (mesma postura da renomeação na revisão de fatura).
 */
function DescriptionCell({
  transaction,
  pending,
  onSave,
}: {
  transaction: Transaction;
  pending: boolean;
  onSave: (transactionId: string, description: string) => void;
}) {
  const [value, setValue] = useState(transaction.description);

  /** Grava a descrição digitada, se ela for válida e diferente da atual. */
  function save() {
    const next = value.trim();
    if (next === "") {
      setValue(transaction.description);
      return;
    }
    if (next === transaction.description) return;
    setValue(next);
    onSave(transaction.id, next);
  }

  return (
    <input
      type="text"
      value={value}
      aria-label={`Descrição de ${transaction.description}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`flex-1 min-w-0 bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-500 dark:hover:border-slate-600 rounded px-1.5 py-1 text-sm outline-none ${
        pending ? "text-red-700 dark:text-red-400" : "text-slate-900 dark:text-slate-100"
      }`}
    />
  );
}

/**
 * Número no padrão brasileiro, sem o "R$" — é o texto que aparece no campo de
 * valor quando ele está editável. Sem o prefixo de moeda porque o campo é para
 * digitar: "R$ " na frente do cursor só estorva (o `parseDecimalInput` até
 * aceitaria o prefixo de volta, mas ninguém quer apagá-lo para trocar o valor).
 */
function formatAmountForInput(value: number): string {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/**
 * Célula da coluna "Valor" no modo editável. Mesmo padrão da célula de
 * descrição: grava por PATCH ao sair do campo (ou no Enter, que só tira o
 * foco), com o texto em edição em estado LOCAL — ler do dado da página faria a
 * resposta do servidor apagar o que está sendo digitado.
 *
 * É `type="text" inputMode="decimal"` e passa por `parseDecimalInput`, como
 * todo campo financeiro do app: `type="number"` não aceita o formato
 * brasileiro, e `Number(x.replace(",", "."))` transformaria "1.234,56" em NaN.
 *
 * Texto ilegível ou valor não positivo é REVERTIDO para o valor atual, não
 * enviado: a rota exige `z.number().positive()`, então devolver o valor
 * anterior é mais honesto do que mandar algo que já se sabe que a API recusa
 * (mesma regra da descrição em branco).
 *
 * Depois de uma gravação boa o campo passa a mostrar o valor JÁ FORMATADO a
 * partir do número interpretado — digitar "1.000" deixa "1,00" no campo. É o
 * mesmo serviço que o `ParsedValueHint` presta nos formulários ("= R$ 1,00"),
 * mas dentro da própria célula: um eco embaixo de cada linha dobraria a altura
 * da tabela (mesmo motivo de ele não estar na lista de diárias do modal de
 * aluguel).
 */
function AmountCell({
  transaction,
  onSave,
}: {
  transaction: Transaction;
  onSave: (transactionId: string, amount: number) => void;
}) {
  const current = Number(transaction.amount);
  const [value, setValue] = useState(() => formatAmountForInput(current));

  /** Grava o valor digitado, se ele for legível, positivo e diferente do atual. */
  function save() {
    const parsed = parseDecimalInput(value);
    if (parsed === null || parsed <= 0) {
      setValue(formatAmountForInput(current));
      return;
    }
    setValue(formatAmountForInput(parsed));
    if (parsed === current) return;
    onSave(transaction.id, parsed);
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      aria-label={`Valor de ${transaction.description}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-24 text-right bg-transparent border border-transparent hover:border-slate-200 focus:border-indigo-500 dark:hover:border-slate-600 rounded px-1.5 py-1 text-sm font-medium outline-none"
    />
  );
}
