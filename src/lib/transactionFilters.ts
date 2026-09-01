// Espelho, no navegador, dos filtros que `GET /api/transactions` aplica no
// banco (ver `where` em src/app/api/transactions/route.ts). Existe para a tela
// de transações poder decidir, sem recarregar a lista inteira, se uma transação
// que ela acabou de editar continua pertencendo ao que está sendo mostrado.
//
// As duas regras precisam continuar dizendo a mesma coisa: mudar o filtro da
// rota sem mudar este arquivo faria a linha editada ficar (ou sumir) na tela
// contra o que a próxima listagem devolveria. É a mesma postura do
// `perRentalValue` do SettlementModal, que espelha o `rentalShare` do servidor.

import { toDateInputValue } from "./dateOnly";
import type { Transaction } from "./types";

/** Os filtros ativos da tela, no formato em que a página `/transacoes` os mantém. */
export interface TransactionFilters {
  /** Início do período, "YYYY-MM-DD" (o dia entra inteiro). */
  from: string;
  /** Fim do período, "YYYY-MM-DD" (o dia entra inteiro). */
  to: string;
  /** Id da categoria; "none" para "sem categoria" e "" para todas. */
  categoryId: string;
  /** Tipo da transação (EXPENSE/INCOME/PAYMENT); "" para todos. */
  type: string;
  /** Busca por texto na descrição; "" para nenhuma. */
  query: string;
}

/**
 * Diz se uma transação casa com todos os filtros ativos — ou seja, se ela
 * apareceria na próxima listagem feita com esses mesmos filtros.
 */
export function matchesTransactionFilters(
  transaction: Transaction,
  filters: TransactionFilters,
): boolean {
  // O período é comparado por DIA, em texto "YYYY-MM-DD". É o que a rota faz
  // com `gte: parseLocalDate(from)` e `lte: parseLocalDateEndOfDay(to)` (o dia
  // do "até" entra inteiro), e comparar as strings evita reconstruir uma `Date`
  // — e com ela o risco de fuso — só para saber o dia.
  const dia = toDateInputValue(transaction.date);
  if (filters.from && dia < filters.from) return false;
  if (filters.to && dia > filters.to) return false;

  // "" = todas as categorias; "none" = só as transações sem categoria.
  if (filters.categoryId === "none") {
    if (transaction.categoryId) return false;
  } else if (filters.categoryId && transaction.categoryId !== filters.categoryId) {
    return false;
  }

  if (filters.type && transaction.type !== filters.type) return false;

  // `contains` com `mode: "insensitive"` no Prisma é o ILIKE do Postgres, que
  // ignora a caixa mas não o acento — `toLowerCase` dos dois lados é o
  // equivalente aqui.
  if (
    filters.query &&
    !transaction.description.toLowerCase().includes(filters.query.toLowerCase())
  ) {
    return false;
  }

  return true;
}

/**
 * Ordena da mais recente para a mais antiga, como o `orderBy: { date: "desc" }`
 * da rota. Devolve um array novo, sem mexer no recebido.
 *
 * O `sort` do JavaScript é estável, então transações do mesmo dia mantêm a
 * ordem em que já estavam. Sem essa reordenação, editar a data de uma linha a
 * deixaria fora de lugar na tabela até o próximo recarregamento da lista.
 */
export function sortTransactionsByDateDesc(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) =>
    toDateInputValue(b.date).localeCompare(toDateInputValue(a.date)),
  );
}
