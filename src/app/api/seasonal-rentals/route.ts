import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addDays, parseLocalDate } from "@/lib/dateOnly";
import { computeRental } from "@/lib/rentalCalc";
import { RENTAL_PLATFORM_LABEL, serializeRentalWithComputed } from "@/lib/seasonalRentals";

const expenseSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
});

const createSchema = z.object({
  platform: z.enum(["AIRBNB", "BOOKING"]),
  checkIn: z.string(),
  checkOut: z.string(),
  netAmountReceived: z.number().nonnegative(),
  cleaningFee: z.number().nonnegative().default(0),
  notes: z.string().nullable().optional(),
  expenses: z.array(expenseSchema).default([]),
});

export async function GET() {
  const rentals = await prisma.seasonalRental.findMany({
    include: { expenses: true },
    orderBy: { checkIn: "desc" },
  });
  return NextResponse.json(rentals.map(serializeRentalWithComputed));
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const checkIn = parseLocalDate(data.checkIn);
  const checkOut = parseLocalDate(data.checkOut);
  const extrasTotal = data.expenses.reduce((sum, e) => sum + e.amount, 0);

  const computed = computeRental({
    checkIn,
    checkOut,
    netAmountReceived: data.netAmountReceived,
    cleaningFee: data.cleaningFee,
    extrasTotal,
  });

  const rental = await prisma.seasonalRental.create({
    data: {
      platform: data.platform,
      checkIn,
      checkOut,
      netAmountReceived: data.netAmountReceived,
      cleaningFee: data.cleaningFee,
      notes: data.notes ?? null,
      expenses: { create: data.expenses },
    },
    include: { expenses: true },
  });

  const category = await prisma.category.findFirst({ where: { name: "Aluguel Rancho" } });

  const incomeTransaction = await prisma.transaction.create({
    data: {
      date: addDays(checkOut, 1),
      description: `Repasse aluguel de temporada (${RENTAL_PLATFORM_LABEL[data.platform]} ${data.checkIn}–${data.checkOut})`,
      amount: computed.totalDavid,
      type: "INCOME",
      source: "IMPORT",
      categoryId: category?.id ?? null,
    },
  });

  const updated = await prisma.seasonalRental.update({
    where: { id: rental.id },
    data: { transactionId: incomeTransaction.id },
    include: { expenses: true },
  });

  return NextResponse.json(serializeRentalWithComputed(updated), { status: 201 });
}
