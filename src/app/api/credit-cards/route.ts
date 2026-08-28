import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/credit-cards
 *
 * Lista todos os cartões de crédito cadastrados (criados automaticamente
 * durante a importação de faturas, um por titular/últimos-4-dígitos
 * encontrado no PDF), ordenados pelo nome do titular.
 */
export async function GET() {
  const cards = await prisma.creditCard.findMany({ orderBy: { holderName: "asc" } });
  return NextResponse.json(cards);
}
