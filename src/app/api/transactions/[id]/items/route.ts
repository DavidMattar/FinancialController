import { NextResponse } from "next/server";
import { z } from "zod";
import { decimalField } from "@/lib/decimalInput";
import { prisma } from "@/lib/prisma";

/**
 * "TransactionItem" (sub-item) é apenas uma quebra informativa/visual de
 * uma transação em partes menores (ex.: uma compra de "Viagem" dividida em
 * "Passagem" + "Hotel"). Os sub-itens NÃO alteram o valor total da
 * transação nem entram nos cálculos de métricas — servem só para o usuário
 * ver o detalhamento na interface.
 */
const createSchema = z.object({
  description: z.string().min(1),
  amount: decimalField(z.number().positive()),
});

/**
 * GET /api/transactions/[id]/items
 *
 * Lista todos os sub-itens (TransactionItem) de uma transação específica,
 * na ordem em que foram criados.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await prisma.transactionItem.findMany({
    where: { transactionId: id },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}

/**
 * POST /api/transactions/[id]/items
 *
 * Cria um novo sub-item (descrição + valor) dentro de uma transação
 * existente. Usado quando o usuário quer detalhar manualmente uma compra
 * em partes (fora dos sub-itens automáticos gerados por `ensureFixedSubItems`
 * para certas categorias).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const item = await prisma.transactionItem.create({
    data: { transactionId: id, description: parsed.data.description, amount: parsed.data.amount },
  });
  return NextResponse.json(item, { status: 201 });
}
