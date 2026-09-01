import { describe, expect, it } from "vitest";
import {
  matchesTransactionFilters,
  sortTransactionsByDateDesc,
  type TransactionFilters,
} from "@/lib/transactionFilters";
import type { Transaction } from "@/lib/types";

/**
 * Estas funções são o espelho, no navegador, do `where`/`orderBy` de
 * `GET /api/transactions`. Elas existem para a tela de transações atualizar
 * apenas a linha editada em vez de recarregar a lista inteira, então o que os
 * testes daqui garantem é que a decisão local ("essa linha continua na lista?")
 * é a mesma que a próxima listagem do servidor daria.
 */
function transacao(over: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    date: "2026-08-15",
    description: "SUPERMERCADO BH",
    amount: "150.00",
    currency: "BRL",
    type: "EXPENSE",
    source: "MANUAL",
    categoryId: "cat-1",
    ...over,
  };
}

/** Filtros de "mês corrente, sem mais nada escolhido" — o padrão da tela. */
function filtros(over: Partial<TransactionFilters> = {}): TransactionFilters {
  return { from: "2026-08-01", to: "2026-08-31", categoryId: "", type: "", query: "", ...over };
}

describe("matchesTransactionFilters — período", () => {
  it("aceita uma data dentro do período", () => {
    expect(matchesTransactionFilters(transacao(), filtros())).toBe(true);
  });

  it("recusa data antes do início", () => {
    expect(matchesTransactionFilters(transacao({ date: "2026-07-31" }), filtros())).toBe(false);
  });

  it("recusa data depois do fim", () => {
    expect(matchesTransactionFilters(transacao({ date: "2026-09-01" }), filtros())).toBe(false);
  });

  it("os dois extremos entram inteiros", () => {
    // O "até" da rota é `parseLocalDateEndOfDay`, ou seja, o dia todo.
    expect(matchesTransactionFilters(transacao({ date: "2026-08-01" }), filtros())).toBe(true);
    expect(matchesTransactionFilters(transacao({ date: "2026-08-31" }), filtros())).toBe(true);
  });

  it("lê o dia LOCAL de uma data ISO completa", () => {
    // 01/09 às 00:00Z ainda é 31/08 no Brasil: a transação pertence a agosto,
    // como a listagem do servidor também diria.
    const t = transacao({ date: "2026-09-01T00:00:00.000Z" });
    expect(matchesTransactionFilters(t, filtros())).toBe(true);
  });

  it("período em branco não filtra nada", () => {
    const t = transacao({ date: "2020-01-01" });
    expect(matchesTransactionFilters(t, filtros({ from: "", to: "" }))).toBe(true);
  });
});

describe("matchesTransactionFilters — categoria", () => {
  it("sem filtro de categoria, qualquer categoria passa", () => {
    expect(matchesTransactionFilters(transacao({ categoryId: null }), filtros())).toBe(true);
  });

  it("aceita só a categoria escolhida", () => {
    expect(matchesTransactionFilters(transacao(), filtros({ categoryId: "cat-1" }))).toBe(true);
    expect(matchesTransactionFilters(transacao(), filtros({ categoryId: "cat-2" }))).toBe(false);
  });

  it("'none' aceita só transação sem categoria", () => {
    const semCategoria = transacao({ categoryId: null });
    expect(matchesTransactionFilters(semCategoria, filtros({ categoryId: "none" }))).toBe(true);
    expect(matchesTransactionFilters(transacao(), filtros({ categoryId: "none" }))).toBe(false);
  });
});

describe("matchesTransactionFilters — tipo e busca", () => {
  it("aceita só o tipo escolhido", () => {
    expect(matchesTransactionFilters(transacao(), filtros({ type: "EXPENSE" }))).toBe(true);
    expect(matchesTransactionFilters(transacao(), filtros({ type: "INCOME" }))).toBe(false);
  });

  it("sem filtro de tipo, qualquer tipo passa", () => {
    expect(matchesTransactionFilters(transacao({ type: "PAYMENT" }), filtros())).toBe(true);
  });

  it("a busca é por trecho da descrição, ignorando a caixa", () => {
    // É o `contains` com `mode: "insensitive"` da rota (ILIKE do Postgres).
    expect(matchesTransactionFilters(transacao(), filtros({ query: "mercado" }))).toBe(true);
    expect(matchesTransactionFilters(transacao(), filtros({ query: "MERCADO" }))).toBe(true);
    expect(matchesTransactionFilters(transacao(), filtros({ query: "padaria" }))).toBe(false);
  });

  it("busca em branco não filtra nada", () => {
    expect(matchesTransactionFilters(transacao(), filtros({ query: "" }))).toBe(true);
  });

  it("todos os filtros precisam casar ao mesmo tempo", () => {
    const f = filtros({ categoryId: "cat-1", type: "EXPENSE", query: "supermercado" });
    expect(matchesTransactionFilters(transacao(), f)).toBe(true);
    expect(matchesTransactionFilters(transacao({ type: "INCOME" }), f)).toBe(false);
  });
});

describe("sortTransactionsByDateDesc", () => {
  it("ordena da mais recente para a mais antiga", () => {
    const lista = [
      transacao({ id: "a", date: "2026-08-10" }),
      transacao({ id: "b", date: "2026-08-20" }),
      transacao({ id: "c", date: "2026-08-15" }),
    ];

    expect(sortTransactionsByDateDesc(lista).map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("mantém a ordem original entre transações do mesmo dia", () => {
    const lista = [
      transacao({ id: "a", date: "2026-08-15" }),
      transacao({ id: "b", date: "2026-08-15" }),
    ];

    expect(sortTransactionsByDateDesc(lista).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("compara pelo dia local, misturando data pura e ISO completo", () => {
    const lista = [
      transacao({ id: "iso", date: "2026-08-15T03:00:00.000Z" }),
      transacao({ id: "pura", date: "2026-08-16" }),
    ];

    expect(sortTransactionsByDateDesc(lista).map((t) => t.id)).toEqual(["pura", "iso"]);
  });

  it("não altera o array recebido", () => {
    const lista = [
      transacao({ id: "a", date: "2026-08-10" }),
      transacao({ id: "b", date: "2026-08-20" }),
    ];

    const ordenada = sortTransactionsByDateDesc(lista);

    expect(lista.map((t) => t.id)).toEqual(["a", "b"]);
    expect(ordenada).not.toBe(lista);
  });
});
