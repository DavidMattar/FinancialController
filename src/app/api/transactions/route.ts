import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma, type TransactionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { suggestCategoryId } from "@/lib/categorize";
import { ensureFixedSubItems } from "@/lib/transactionItems";
import { parseLocalDate, parseLocalDateEndOfDay } from "@/lib/dateOnly";

/** Formato aceito no corpo (body) do POST para criar uma transação manualmente. */
const createSchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(["EXPENSE", "INCOME", "PAYMENT"]).default("EXPENSE"),
  categoryId: z.string().nullable().optional(),
  creditCardId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/transactions
 *
 * Lista transações, com filtros opcionais via query string:
 * - from / to: intervalo de datas (formato "YYYY-MM-DD"). Usamos
 *   `parseLocalDate`/`parseLocalDateEndOfDay` em vez de `new Date()` direto
 *   porque `new Date("YYYY-MM-DD")` é interpretado como meia-noite em UTC,
 *   o que no fuso horário do Brasil (UTC-3) "vira" o dia anterior. Esses
 *   helpers constroem a data usando os componentes locais, evitando o bug.
 * - categoryId: filtra por categoria específica, ou "none" para transações
 *   sem categoria.
 * - type: filtra por tipo (EXPENSE, INCOME, PAYMENT).
 * - q: busca por texto (case-insensitive) na descrição.
 * - cardId: filtra por cartão de crédito específico.
 * - pendingReturn: se "true", retorna apenas transações marcadas como
 *   "aguardando possível devolução" (ex.: compras de e-commerce recentes).
 *
 * Retorna a lista de transações já com a categoria e o cartão de crédito
 * relacionados (include), ordenadas da mais recente para a mais antiga.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const categoryId = searchParams.get("categoryId");
  const type = searchParams.get("type");
  const q = searchParams.get("q");
  const cardId = searchParams.get("cardId");
  const pendingReturn = searchParams.get("pendingReturn");

  const where: Prisma.TransactionWhereInput = {};
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = parseLocalDate(from);
    if (to) where.date.lte = parseLocalDateEndOfDay(to);
  }
  if (categoryId) where.categoryId = categoryId === "none" ? null : categoryId;
  if (type) where.type = type as TransactionType;
  if (cardId) where.creditCardId = cardId;
  if (q) where.description = { contains: q, mode: "insensitive" };
  if (pendingReturn === "true") where.pendingReturn = true;

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, creditCard: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transactions);
}

/**
 * POST /api/transactions
 *
 * Cria uma transação manualmente (digitada pelo usuário, diferente das
 * transações que vêm de importação de fatura/nota fiscal, cujo `source`
 * é "IMPORT").
 *
 * Passos:
 * 1. Valida o corpo da requisição contra `createSchema`.
 * 2. Se o usuário não escolheu uma categoria, tenta adivinhar uma
 *    automaticamente com `suggestCategoryId` (baseado em palavras-chave
 *    cadastradas nas categorias).
 * 3. Se a categoria escolhida (ou sugerida) for do tipo "INCOME" (receita),
 *    força o tipo da transação para INCOME mesmo que o usuário tenha
 *    mandado outro valor — isso implementa a regra de "categoria de receita
 *    trava o tipo como receita" combinada anteriormente.
 * 4. Grava a transação no banco, usando `parseLocalDate` para converter a
 *    data (string "YYYY-MM-DD") evitando o bug de fuso horário descrito no
 *    GET acima.
 * 5. Chama `ensureFixedSubItems`, que cria sub-itens fixos automáticos para
 *    certas categorias (ex.: "Viagem" sempre vem com sub-itens padrão) —
 *    isso é só uma quebra visual/informativa da transação, não afeta o
 *    valor total.
 *
 * Retorna a transação criada (com categoria e cartão populados) e status 201.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const categoryId = data.categoryId ?? (await suggestCategoryId(data.description));

  let type: TransactionType = data.type;
  if (categoryId) {
    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { kind: true } });
    if (category?.kind === "INCOME") type = "INCOME";
  }

  const transaction = await prisma.transaction.create({
    data: {
      date: parseLocalDate(data.date),
      description: data.description,
      amount: data.amount,
      type,
      categoryId,
      creditCardId: data.creditCardId ?? null,
      notes: data.notes ?? null,
      source: "MANUAL",
    },
    include: { category: true, creditCard: true },
  });

  await ensureFixedSubItems(transaction.id, categoryId);

  return NextResponse.json(transaction, { status: 201 });
}
