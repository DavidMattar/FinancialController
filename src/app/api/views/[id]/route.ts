import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/views/[id]
 * Remove uma visualização de dashboard salva. Se ela era a padrão, nenhuma outra
 * assume automaticamente esse papel — o dashboard volta a abrir sem filtro pré-aplicado.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.dashboardView.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
