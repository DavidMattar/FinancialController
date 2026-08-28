import { NextResponse } from "next/server";
import { previewSettlement, type SettlementType } from "@/lib/rentalSettlements";

/**
 * GET /api/rental-settlements/preview?from=&to=&type=DAVID|FAMILIA
 * Mostra, sem gravar nada, quais aluguéis entrariam em um repasse se ele fosse
 * gerado agora para o período e tipo informados, e o total resultante — usado
 * pelo modal "Fechar repasse do período" para o usuário revisar antes de confirmar.
 * A lógica de soma (e a divisão por 2 no caso FAMILIA) é a mesma usada depois na
 * criação real do repasse (src/lib/rentalSettlements.ts), garantindo que o preview
 * nunca destoe do valor efetivamente gerado.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const type = searchParams.get("type") as SettlementType | null;
  if (!from || !to || (type !== "DAVID" && type !== "FAMILIA")) {
    return NextResponse.json({ error: "Informe from, to e type (DAVID ou FAMILIA)." }, { status: 400 });
  }

  const preview = await previewSettlement(type, from, to);
  return NextResponse.json(preview);
}
