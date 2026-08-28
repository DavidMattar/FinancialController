import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSettlement } from "@/lib/rentalSettlements";

const createSchema = z.object({
  type: z.enum(["DAVID", "FAMILIA"]),
  periodFrom: z.string(),
  periodTo: z.string(),
});

/**
 * GET /api/rental-settlements
 * Lista o histórico de repasses ("fechamentos") já gerados, mais recentes primeiro.
 * Cada registro é imutável: uma vez criado, "trava" os aluguéis daquele período
 * e tipo (ver src/lib/rentalSettlements.ts) para que não sejam somados de novo em
 * um repasse futuro. Não existe endpoint de "desfazer repasse" — essa funcionalidade
 * foi pedida e depois explicitamente recusada pelo usuário, que preferiu manter o
 * comportamento de trava permanente após o fechamento.
 */
export async function GET() {
  const settlements = await prisma.rentalSettlement.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(settlements.map((s) => ({ ...s, totalAmount: Number(s.totalAmount) })));
}

/**
 * POST /api/rental-settlements
 * Gera um registro de repasse para um período e tipo (`DAVID` ou `FAMILIA`).
 *
 * Existem dois tipos independentes de repasse porque são dois destinatários
 * diferentes com regras de cálculo diferentes:
 *   - DAVID: soma o campo "Total David" de cada aluguel do período ainda não
 *     fechado para David (`davidSettlementId` nulo).
 *   - FAMILIA: soma o "Valor líquido para distribuição" de cada aluguel do
 *     período ainda não fechado para a família (`familiaSettlementId` nulo) e
 *     divide o total por 2.
 * Por isso o SeasonalRental tem dois campos de FK de settlement separados —
 * um aluguel pode estar fechado para David mas ainda pendente para a família,
 * ou vice-versa, de forma totalmente independente.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { type, periodFrom, periodTo } = parsed.data;

  const settlement = await createSettlement(type, periodFrom, periodTo);
  if (!settlement) {
    return NextResponse.json(
      { error: "Nenhum aluguel não liquidado encontrado nesse período para esse tipo de repasse." },
      { status: 422 },
    );
  }

  return NextResponse.json({ ...settlement, totalAmount: Number(settlement.totalAmount) }, { status: 201 });
}
