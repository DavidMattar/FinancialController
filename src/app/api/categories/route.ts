import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Formato aceito para criar uma categoria.
 * - kind: "EXPENSE" (gasto) ou "INCOME" (receita). Categorias INCOME travam
 *   automaticamente o tipo de qualquer transação associada a elas (ver
 *   regra em /api/transactions).
 * - keywords: lista de palavras-chave usadas por `suggestCategoryId`
 *   (em @/lib/categorize) para sugerir automaticamente essa categoria
 *   quando a descrição de uma transação contém uma dessas palavras.
 * - deductsFromFreeSpend: se true, gastos nessa categoria descontam do
 *   valor "livre para gastar" (os 15% do orçamento mensal) mostrado no
 *   banner do dashboard.
 */
const createSchema = z.object({
  name: z.string().min(1),
  color: z.string().default("#6366f1"),
  icon: z.string().default("tag"),
  kind: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE"),
  keywords: z.array(z.string()).default([]),
  deductsFromFreeSpend: z.boolean().default(false),
});

/**
 * GET /api/categories
 *
 * Lista todas as categorias cadastradas, ordenadas por nome.
 */
export async function GET() {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(categories);
}

/**
 * POST /api/categories
 *
 * Cria uma nova categoria (de gasto ou receita) com cor, ícone, palavras-chave
 * para auto-categorização e a flag de desconto do "livre para gastar".
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const category = await prisma.category.create({ data: parsed.data });
  return NextResponse.json(category, { status: 201 });
}
