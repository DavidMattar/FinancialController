import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Só a identidade do ativo é editável por aqui. Quantidade e custo médio saíram
 * deste schema porque deixaram de ser colunas: são a soma das compras
 * (`InvestmentPurchase`). Para mudar a posição, registre uma compra nova
 * (POST /api/investments) ou apague uma compra errada
 * (DELETE /api/investments/[id]/purchases/[purchaseId]).
 */
const updateSchema = z.object({
  symbol: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
});

/**
 * PATCH /api/investments/[id]
 * Atualiza símbolo, nome ou descrição de uma posição (todos opcionais — só
 * altera o que for enviado). É por aqui que a coluna "Descrição" da tabela
 * grava o comentário do usuário sobre o ativo.
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
 * Remove permanentemente uma posição de investimento e, por `onDelete: Cascade`,
 * todas as compras dela. Não afeta transações do fluxo de caixa (investimentos
 * são cadastro separado, sem histórico de aportes no ledger).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.investmentHolding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
