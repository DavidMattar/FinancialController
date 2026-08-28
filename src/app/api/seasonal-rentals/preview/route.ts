import { NextResponse } from "next/server";
import { z } from "zod";
import { parseLocalDate } from "@/lib/dateOnly";
import { computeRental } from "@/lib/rentalCalc";
import { suggestCleaningFee } from "@/lib/rentalPriceTable";

const previewSchema = z.object({
  checkIn: z.string(),
  checkOut: z.string(),
  netAmountReceived: z.number().nonnegative(),
  cleaningFee: z.number().nonnegative().default(0),
  extrasTotal: z.number().nonnegative().default(0),
});

/**
 * POST /api/seasonal-rentals/preview
 * Calcula em tempo real (sem gravar nada no banco) todos os valores derivados de
 * um aluguel de temporada a partir dos dados digitados no formulário — usado para
 * mostrar o preview ao vivo no modal "Novo registro de aluguel" antes de confirmar.
 *
 * `tableValue` (valor de tabela para as datas escolhidas) NUNCA é salvo no banco:
 * ele é sempre recalculado a partir de src/lib/rentalPriceTable.ts, para que uma
 * correção futura na tabela de preços "Tabela Rancho" se reflita automaticamente
 * em todos os alugueis (passados e futuros), sem precisar migrar dados antigos.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = previewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const checkIn = parseLocalDate(data.checkIn);
  const checkOut = parseLocalDate(data.checkOut);

  if (checkOut <= checkIn) {
    return NextResponse.json({ error: "A data de saída deve ser depois da data de entrada." }, { status: 400 });
  }

  const computed = computeRental({
    checkIn,
    checkOut,
    netAmountReceived: data.netAmountReceived,
    cleaningFee: data.cleaningFee,
    extrasTotal: data.extrasTotal,
  });

  return NextResponse.json({ ...computed, suggestedCleaningFee: suggestCleaningFee() });
}
