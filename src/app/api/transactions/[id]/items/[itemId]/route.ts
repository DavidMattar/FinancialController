import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/** Formato aceito no corpo do PATCH — ambos os campos são opcionais. */
const updateSchema = z.object({
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
});

/**
 * PATCH /api/transactions/[id]/items/[itemId]
 *
 * Edita a descrição e/ou o valor de um sub-item (TransactionItem) já
 * existente. Lembre-se: sub-itens são só uma quebra visual/informativa —
 * editar um sub-item não altera o valor total da transação "pai".
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { itemId } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const item = await prisma.transactionItem.update({ where: { id: itemId }, data: parsed.data });
  return NextResponse.json(item);
}

/**
 * DELETE /api/transactions/[id]/items/[itemId]
 *
 * Remove um sub-item específico. Não afeta a transação "pai" nem seu
 * valor total.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { itemId } = await params;
  await prisma.transactionItem.delete({ where: { id: itemId } });
  return NextResponse.json({ ok: true });
}
