import { NextResponse } from "next/server";
import { z } from "zod";
import { decimalField } from "@/lib/decimalInput";
import { prisma } from "@/lib/prisma";
import { addDays, parseLocalDate } from "@/lib/dateOnly";
import { computeRental } from "@/lib/rentalCalc";
import { sanitizeNightRateOverrides } from "@/lib/rentalPriceTable";
import { RENTAL_PLATFORM_LABEL, serializeRentalWithComputed } from "@/lib/seasonalRentals";

const expenseSchema = z.object({
  description: z.string().min(1),
  amount: decimalField(z.number().positive()),
});

const updateSchema = z.object({
  platform: z.enum(["AIRBNB", "BOOKING"]),
  checkIn: z.string(),
  checkOut: z.string(),
  netAmountReceived: decimalField(z.number().nonnegative()),
  cleaningFee: decimalField(z.number().nonnegative().default(0)),
  notes: z.string().nullable().optional(),
  expenses: z.array(expenseSchema).default([]),
  // Diárias customizadas SÓ deste aluguel: { "YYYY-MM-DD": valor }. Como a
  // lista de gastos extras, é substituída por completo a cada edição — o
  // formulário sempre envia o mapa inteiro, e um mapa vazio significa
  // "voltar a usar a tabela de preços em todas as noites".
  nightRateOverrides: z.record(z.string(), decimalField(z.number().nonnegative())).nullish(),
});

/**
 * PUT /api/seasonal-rentals/[id]
 * Edita um aluguel já cadastrado — incluindo os que já tiveram repasse
 * gerado (David e/ou Família). O `RentalSettlement.totalAmount` já fechado
 * é permanente e NUNCA é recalculado aqui (ver contexto.md, seção 4.2): só o
 * registro do aluguel em si e a Transaction de receita vinculada
 * (`transactionId`, o "Total David") são atualizados, para refletir a
 * correção nas telas que leem o aluguel/transação a partir de agora.
 * Substitui a lista de gastos extras por completo (delete + recreate) e, do
 * mesmo jeito, substitui por completo o mapa de diárias customizadas
 * (`nightRateOverrides`) — é por aí que o usuário ajusta o valor da diária de
 * um aluguel específico sem mexer na tabela de preços nem em outros aluguéis.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const existing = await prisma.seasonalRental.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Aluguel não encontrado." }, { status: 404 });
  }

  const checkIn = parseLocalDate(data.checkIn);
  const checkOut = parseLocalDate(data.checkOut);
  const extrasTotal = data.expenses.reduce((sum, e) => sum + e.amount, 0);
  // Diárias customizadas de noites que saíram do período (usuário mudou as
  // datas depois de customizar) são descartadas em vez de ficarem órfãs no Json.
  const nightRateOverrides = sanitizeNightRateOverrides(data.nightRateOverrides, checkIn, checkOut);
  const computed = computeRental({
    checkIn,
    checkOut,
    netAmountReceived: data.netAmountReceived,
    cleaningFee: data.cleaningFee,
    extrasTotal,
    nightRateOverrides,
  });

  // Substitui os gastos extras por completo em vez de tentar casar por id —
  // o formulário de edição sempre envia a lista inteira atual.
  await prisma.seasonalRentalExpense.deleteMany({ where: { seasonalRentalId: id } });

  const updated = await prisma.seasonalRental.update({
    where: { id },
    data: {
      platform: data.platform,
      checkIn,
      checkOut,
      netAmountReceived: data.netAmountReceived,
      cleaningFee: data.cleaningFee,
      notes: data.notes ?? null,
      nightRateOverrides,
      expenses: { create: data.expenses },
    },
    include: { expenses: true },
  });

  // Mantém a transação de crédito (receita) gerada automaticamente em sincronia
  // com o novo Total David — se ela já tiver sido apagada manualmente na tela
  // de transações, o `.catch(() => {})` evita que isso quebre a edição do aluguel.
  if (updated.transactionId) {
    await prisma.transaction
      .update({
        where: { id: updated.transactionId },
        data: {
          date: addDays(checkOut, 1),
          description: `Repasse aluguel de temporada (${RENTAL_PLATFORM_LABEL[data.platform]} ${data.checkIn}–${data.checkOut})`,
          amount: computed.totalDavid,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json(serializeRentalWithComputed(updated));
}

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
