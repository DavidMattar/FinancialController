import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureFixedSubItems } from "@/lib/transactionItems";
import { parseLocalDate } from "@/lib/dateOnly";

/** Um item de compra do supermercado (linha da nota), já revisado pelo usuário. */
const itemSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
});

/** Formato do corpo enviado pela tela de revisão da nota fiscal. */
const confirmSchema = z.object({
  date: z.string(),
  storeName: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1),
});

/**
 * POST /api/receipts/confirm
 *
 * Segunda etapa do fluxo de importação de nota fiscal: grava no banco a
 * transação de supermercado revisada pelo usuário (vinda da tela que
 * consumiu /api/receipts/parse). Diferente da fatura de cartão (que gera
 * uma transação por lançamento), aqui é criada UMA única transação para a
 * compra inteira (valor = soma de todos os itens), e cada item da nota se
 * torna um `TransactionItem` — um sub-item informativo dentro dela.
 *
 * Passos:
 * 1. Soma o valor de todos os itens para obter o total da compra.
 * 2. Cria a transação principal, do tipo EXPENSE e `source: "IMPORT"`,
 *    usando `parseLocalDate` para converter a data "YYYY-MM-DD" e evitar
 *    o bug de fuso horário (uma data-only interpretada como UTC meia-noite
 *    viraria o dia anterior no horário do Brasil se usássemos
 *    `new Date()` direto).
 * 3. Cria um `TransactionItem` para cada item da nota, ligado à transação
 *    criada.
 * 4. Roda `ensureFixedSubItems` para aplicar, se aplicável, as regras
 *    automáticas de sub-itens fixos da categoria escolhida.
 *
 * Retorna o id da transação criada, a quantidade de itens importados e o
 * valor total.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const totalAmount = data.items.reduce((sum, item) => sum + item.amount, 0);

  const transaction = await prisma.transaction.create({
    data: {
      date: parseLocalDate(data.date),
      description: data.storeName,
      amount: totalAmount,
      type: "EXPENSE",
      categoryId: data.categoryId ?? null,
      source: "IMPORT",
    },
  });

  await prisma.transactionItem.createMany({
    data: data.items.map((item) => ({
      transactionId: transaction.id,
      description: item.description,
      amount: item.amount,
    })),
  });

  await ensureFixedSubItems(transaction.id, data.categoryId ?? null);

  return NextResponse.json({ transactionId: transaction.id, itemsImported: data.items.length, totalAmount });
}
