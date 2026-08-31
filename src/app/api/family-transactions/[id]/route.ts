import { NextResponse } from "next/server";
import { z } from "zod";
import { decimalField } from "@/lib/decimalInput";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/dateOnly";

const updateSchema = z.object({
  date: z.string().optional(),
  description: z.string().min(1).optional(),
  amount: decimalField(z.number().positive().optional()),
  type: z.enum(["EXPENSE", "INCOME"]).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * PATCH /api/family-transactions/[id]
 * Atualiza um lançamento do ledger da família (campos opcionais — só altera o que
 * vier no corpo). Se `date` for enviada, passa por `parseLocalDate` pela mesma razão
 * de fuso horário aplicada na criação.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { date, ...rest } = parsed.data;
  const transaction = await prisma.familyTransaction.update({
    where: { id },
    data: { ...rest, ...(date ? { date: parseLocalDate(date) } : {}) },
  });
  return NextResponse.json(transaction);
}

/**
 * DELETE /api/family-transactions/[id]
 * Remove permanentemente um lançamento do ledger isolado da família.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.familyTransaction.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
