import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  type: z.enum(["CRYPTO", "CURRENCY"]),
  symbol: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().positive(),
  avgCostBrl: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/investments
 * Lista todas as posições de investimento (cripto e moeda estrangeira) cadastradas,
 * na ordem em que foram criadas. Retorna os valores "crus" salvos no banco (quantidade
 * e custo médio) — não busca cotação atual aqui; isso é feito em /api/investments/prices.
 */
export async function GET() {
  const holdings = await prisma.investmentHolding.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(holdings);
}

/**
 * POST /api/investments
 * Cria uma nova posição de investimento (ex: "0.5 BTC a custo médio de R$ 200.000").
 * Espera { type, symbol, name, quantity, avgCostBrl, notes? } no corpo da requisição.
 * Apenas registra a posição — a cotação atual (para calcular lucro/perda) é buscada
 * separadamente e em tempo real pelo endpoint de preços.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const holding = await prisma.investmentHolding.create({ data: parsed.data });
  return NextResponse.json(holding, { status: 201 });
}
