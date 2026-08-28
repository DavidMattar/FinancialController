import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/** Formato aceito no PATCH — todos os campos opcionais (edição parcial). */
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  kind: z.enum(["EXPENSE", "INCOME"]).optional(),
  keywords: z.array(z.string()).optional(),
  deductsFromFreeSpend: z.boolean().optional(),
});

/**
 * PATCH /api/categories/[id]
 *
 * Atualiza parcialmente os dados de uma categoria (nome, cor, ícone, tipo,
 * palavras-chave de auto-categorização, ou a flag de desconto do "livre
 * para gastar").
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const category = await prisma.category.update({ where: { id }, data: parsed.data });
  return NextResponse.json(category);
}

/**
 * DELETE /api/categories/[id]
 *
 * Exclui uma categoria, com uma proteção importante: categorias que têm
 * "sub-itens fixos" configurados (`fixedSubItems`) possuem uma regra de
 * negócio automática vinculada a elas (ex.: a categoria "Viagem" sempre
 * gera sub-itens padrão em toda transação nova) — excluir essa categoria
 * quebraria essa automação, então a exclusão é bloqueada com erro 400.
 *
 * Se a categoria puder ser excluída, todas as transações que a usavam
 * ficam sem categoria (`categoryId: null`) em vez de serem excluídas junto.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const category = await prisma.category.findUnique({ where: { id }, select: { name: true, fixedSubItems: true } });
  if (!category) {
    return NextResponse.json({ error: "Categoria não encontrada." }, { status: 404 });
  }
  if (category.fixedSubItems.length > 0) {
    return NextResponse.json(
      {
        error: `A categoria "${category.name}" tem uma regra de negócio associada (sub-itens fixos automáticos) e não pode ser excluída.`,
      },
      { status: 400 },
    );
  }
  await prisma.transaction.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
  await prisma.category.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
