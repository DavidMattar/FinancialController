import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/seasonal-rentals/[id]
 * Remove um registro de aluguel de temporada. Como toda criação de aluguel gera
 * automaticamente uma Transaction de receita (o "Total David") na categoria
 * "Aluguel Rancho", a exclusão precisa desfazer os dois lados: primeiro tenta
 * apagar a Transaction vinculada (`transactionId`) — o `.catch(() => {})` absorve
 * o caso em que ela já não existe mais (ex: apagada manualmente na tela de
 * transações) para não travar a exclusão do aluguel — e só depois apaga o
 * próprio SeasonalRental.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rental = await prisma.seasonalRental.findUnique({ where: { id }, select: { transactionId: true } });
  if (rental?.transactionId) {
    await prisma.transaction.delete({ where: { id: rental.transactionId } }).catch(() => {});
  }
  await prisma.seasonalRental.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
