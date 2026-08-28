import { prisma } from "@/lib/prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Escapa um valor para uso seguro dentro de uma célula CSV: se o texto
 * contém aspas, vírgula ou quebra de linha, envolve o valor em aspas duplas
 * e duplica as aspas internas (regra padrão do formato CSV/RFC 4180).
 */
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * GET /api/transactions/export
 *
 * Gera e devolve um arquivo CSV com as transações filtradas, para o
 * usuário baixar como "relatório". Aceita os mesmos filtros de data e
 * categoria usados em /api/transactions e /api/transactions/metrics:
 * - from / to: intervalo de datas, convertido com `parseLocalDate` /
 *   `parseLocalDateEndOfDay` para evitar o bug de fuso horário (uma data
 *   "YYYY-MM-DD" interpretada como UTC meia-noite viraria o dia anterior
 *   no horário do Brasil se usássemos `new Date()` direto).
 * - categoryIds: lista de ids separados por vírgula, com "none"
 *   representando "sem categoria"; se vier vazio, não retorna nada.
 *
 * Monta manualmente as linhas do CSV (separador ";", que o Excel em
 * português reconhece melhor que ","), formata o valor com vírgula decimal
 * (padrão brasileiro) e adiciona um BOM UTF-8 no início do arquivo para
 * o Excel abrir os acentos corretamente. A resposta é enviada com o header
 * `Content-Disposition: attachment`, o que faz o navegador baixar o
 * arquivo em vez de exibi-lo.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const categoryIdsParam = searchParams.get("categoryIds");

  const where: Prisma.TransactionWhereInput = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = parseLocalDate(from);
    if (to) where.date.lte = parseLocalDateEndOfDay(to);
  }
  if (categoryIdsParam !== null) {
    const ids = categoryIdsParam.split(",").filter(Boolean);
    if (ids.length === 0) {
      // Explicit empty selection: match nothing.
      where.id = "__no_category_selected__";
    } else {
      const wantsUncategorized = ids.includes("none");
      const realIds = ids.filter((id) => id !== "none");
      if (wantsUncategorized && realIds.length > 0) {
        where.OR = [{ categoryId: { in: realIds } }, { categoryId: null }];
      } else if (wantsUncategorized) {
        where.categoryId = null;
      } else {
        where.categoryId = { in: realIds };
      }
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, creditCard: true },
    orderBy: { date: "asc" },
  });

  const header = ["Data", "Descrição", "Categoria", "Cartão", "Tipo", "Valor (BRL)"];
  const rows = transactions.map((t) => [
    t.date.toISOString().slice(0, 10),
    t.description,
    t.category?.name ?? "",
    t.creditCard ? `${t.creditCard.bank} ****${t.creditCard.lastDigits}` : "",
    t.type,
    Number(t.amount).toFixed(2).replace(".", ","),
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(";")).join("\n");
  const csvWithBom = "﻿" + csv;

  return new Response(csvWithBom, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transacoes.csv"`,
    },
  });
}
