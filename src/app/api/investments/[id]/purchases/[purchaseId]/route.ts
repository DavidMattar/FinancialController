import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/investments/[id]/purchases/[purchaseId]
 * Apaga UMA compra de um ativo (o "excluir" de cada linha da lista expandida).
 *
 * Por que esta rota existe: agora que a compra individual é gravada, e que
 * quantidade e custo médio saem da soma delas, um aporte digitado errado não
 * pode mais ser consertado por um PATCH na posição — o único jeito seria apagar
 * o ativo inteiro e relançar todas as compras. Esta rota é o conserto pontual.
 *
 * **Apagar a última compra apaga a posição junto.** Uma posição sem compra
 * nenhuma não é uma posição: apareceria na tabela com quantidade e custo zero,
 * sem nenhuma forma de distinguir de um ativo realmente zerado. As duas
 * exclusões acontecem na MESMA transação do Postgres — sem isso, uma falha no
 * meio deixaria exatamente esse registro fantasma.
 *
 * A compra é buscada com `holdingId` no filtro (e não só pelo id dela) para uma
 * URL com o par trocado não apagar a compra de outro ativo.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; purchaseId: string }> },
) {
  const { id, purchaseId } = await params;

  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.investmentPurchase.findFirst({
      where: { id: purchaseId, holdingId: id },
    });
    if (!purchase) return null;

    await tx.investmentPurchase.delete({ where: { id: purchaseId } });
    const remaining = await tx.investmentPurchase.count({ where: { holdingId: id } });
    if (remaining === 0) {
      await tx.investmentHolding.delete({ where: { id } });
      return { ok: true, holdingDeleted: true };
    }
    return { ok: true, holdingDeleted: false };
  });

  if (!result) {
    return NextResponse.json({ error: "Compra não encontrada neste ativo." }, { status: 404 });
  }
  return NextResponse.json(result);
}
