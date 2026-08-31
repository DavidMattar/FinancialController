import { NextResponse } from "next/server";
import { z } from "zod";
import { decimalField } from "@/lib/decimalInput";
import { prisma } from "@/lib/prisma";
import { parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";
import type { Prisma } from "@/generated/prisma/client";

const createSchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  amount: decimalField(z.number().positive()),
  type: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE"),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/family-transactions
 * Lista o "ledger" (livro-caixa) de Transações Família, opcionalmente filtrado por
 * período (`from`/`to`, datas no formato YYYY-MM-DD).
 *
 * Este modelo é 100% ISOLADO do restante do app: não aparece nos relatórios, nos
 * gráficos do dashboard, no cálculo dos 15%/10%/75% do orçamento nem nas métricas
 * de gastos por categoria. É uma contabilidade paralela e intencionalmente separada
 * (dinheiro/despesas da família, não do usuário individualmente), por isso vive em
 * sua própria tabela (`FamilyTransaction`) em vez de reaproveitar `Transaction`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Prisma.FamilyTransactionWhereInput = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = parseLocalDate(from);
    if (to) where.date.lte = parseLocalDateEndOfDay(to);
  }

  const transactions = await prisma.familyTransaction.findMany({
    where,
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transactions);
}

/**
 * POST /api/family-transactions
 * Cria um lançamento no ledger isolado da família (receita ou despesa). Usa
 * `parseLocalDate` para converter a data YYYY-MM-DD evitando o bug de fuso horário
 * (ver src/lib/dateOnly.ts): interpretar a string como UTC faria a data "voltar"
 * um dia em horário de Brasília.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const transaction = await prisma.familyTransaction.create({
    data: {
      date: parseLocalDate(data.date),
      description: data.description,
      amount: data.amount,
      type: data.type,
      notes: data.notes ?? null,
    },
  });
  return NextResponse.json(transaction, { status: 201 });
}
