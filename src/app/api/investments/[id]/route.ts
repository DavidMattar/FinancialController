import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  symbol: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  quantity: z.number().positive().optional(),
  avgCostBrl: z.number().nonnegative().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * PATCH /api/investments/[id]
 * Atualiza campos de uma posição de investimento existente (todos os campos são
 * opcionais — só altera o que for enviado). Usado, por exemplo, para ajustar a
 * quantidade e o custo médio após uma nova compra do mesmo ativo.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const holding = await prisma.investmentHolding.update({ where: { id }, data: parsed.data });
  return NextResponse.json(holding);
}

/**
 * DELETE /api/investments/[id]
 * Remove permanentemente uma posição de investimento. Não afeta transações do
 * fluxo de caixa (investimentos são cadastro separado, sem histórico de aportes).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.investmentHolding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
