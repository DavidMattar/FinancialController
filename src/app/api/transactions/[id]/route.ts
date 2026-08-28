import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureFixedSubItems } from "@/lib/transactionItems";
import { parseLocalDate } from "@/lib/dateOnly";
import type { TransactionType } from "@/generated/prisma/client";

/**
 * Formato aceito no corpo (body) do PATCH. Todos os campos são opcionais
 * porque o usuário pode estar editando só um detalhe (ex.: só a categoria,
 * ou só marcando/desmarcando `pendingReturn`).
 */
const updateSchema = z.object({
  date: z.string().optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  type: z.enum(["EXPENSE", "INCOME", "PAYMENT"]).optional(),
  categoryId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  pendingReturn: z.boolean().optional(),
});

/**
 * PATCH /api/transactions/[id]
 *
 * Atualiza parcialmente uma transação existente (edição feita pelo usuário).
 *
 * Regras aplicadas:
 * - Se uma nova `categoryId` for enviada e essa categoria for do tipo
 *   "INCOME" (receita), o tipo da transação é forçado para INCOME, igual à
 *   regra usada na criação (ver POST em transactions/route.ts).
 * - Se uma nova `date` (string "YYYY-MM-DD") for enviada, ela é convertida
 *   com `parseLocalDate` para não sofrer o bug de fuso horário (ver
 *   explicação detalhada no GET de transactions/route.ts).
 * - Se a categoria mudou, `ensureFixedSubItems` roda de novo para garantir
 *   que os sub-itens fixos automáticos (ex.: categoria "Viagem") fiquem
 *   consistentes com a nova categoria.
 *
 * Retorna a transação já atualizada, com categoria e cartão populados.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { date, categoryId, ...rest } = parsed.data;

  let type: TransactionType | undefined = rest.type;
  if (categoryId !== undefined && categoryId !== null) {
    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { kind: true } });
    if (category?.kind === "INCOME") type = "INCOME";
  }

  const transaction = await prisma.transaction.update({
    where: { id },
    data: {
      ...rest,
      ...(type !== undefined ? { type } : {}),
      ...(categoryId !== undefined ? { categoryId } : {}),
      ...(date ? { date: parseLocalDate(date) } : {}),
    },
    include: { category: true, creditCard: true },
  });

  if (categoryId !== undefined && categoryId !== null) {
    await ensureFixedSubItems(transaction.id, categoryId);
  }

  return NextResponse.json(transaction);
}

/**
 * DELETE /api/transactions/[id]
 *
 * Exclui permanentemente uma transação pelo id. Não tem corpo de
 * requisição — o id vem da própria URL. Retorna `{ ok: true }` em caso de
 * sucesso.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.transaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
