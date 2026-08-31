import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ensureFixedSubItems } from "@/lib/transactionItems";

/** Identifica um cartão pelo nome do titular + últimos 4 dígitos. */
const cardSchema = z.object({
  holderName: z.string().min(1),
  lastDigits: z.string().min(1),
});

/**
 * Formato de cada lançamento vindo da tela de revisão (depois de o usuário
 * já ter conferido/corrigido o que foi extraído em /api/invoices/parse).
 */
const transactionSchema = z.object({
  date: z.string(),
  description: z.string().min(1),
  amount: z.number(),
  amountUsd: z.number().nullable().optional(),
  type: z.enum(["EXPENSE", "INCOME", "PAYMENT"]),
  section: z.enum(["DESPESA", "CREDITO", "PARCELAMENTO"]),
  installmentCurrent: z.number().nullable().optional(),
  installmentTotal: z.number().nullable().optional(),
  cardHolder: z.string().min(1),
  cardLastDigits: z.string().min(1),
  categoryId: z.string().nullable().optional(),
  // Marcado na própria tela de revisão, antes de gravar — permite sinalizar
  // vários lançamentos da mesma fatura de uma vez, em vez de abrir a transação
  // uma por uma depois de importar.
  pendingReturn: z.boolean().optional(),
});

/** Formato completo do corpo enviado pela tela de revisão da fatura. */
const confirmSchema = z.object({
  bank: z.string().min(1),
  referenceMonth: z.string().regex(/^\d{4}-\d{2}$/),
  dueDate: z.string().nullable().optional(),
  totalAmount: z.number(),
  minPayment: z.number().nullable().optional(),
  fileName: z.string(),
  primaryCard: cardSchema,
  transactions: z.array(transactionSchema).min(1),
});

/**
 * POST /api/invoices/confirm
 *
 * Segunda etapa do fluxo de importação de fatura: grava de fato no banco
 * os lançamentos que o usuário revisou/aprovou na tela de pré-visualização
 * (gerada por /api/invoices/parse). Esse é o único endpoint da importação
 * de fatura que efetivamente escreve no banco de dados.
 *
 * Passos:
 * 1. Garante que exista um `CreditCard` (cartão) cadastrado para cada
 *    titular/últimos-4-dígitos encontrado nos lançamentos — usa `upsert`
 *    porque o mesmo cartão pode já existir de uma importação anterior.
 * 2. Cria ou atualiza (`upsert`) o registro de `Invoice` (fatura) daquele
 *    mês de referência para o cartão principal — permite reimportar a
 *    mesma fatura (ex.: corrigindo algo) sem duplicar.
 * 3. Apaga quaisquer transações que já existiam ligadas a essa fatura
 *    (`deleteMany`) antes de recriar — isso é o que torna a reimportação
 *    segura/idempotente: a fatura antiga é totalmente substituída.
 * 4. Cria todas as transações da fatura de uma vez (`createMany`), cada
 *    uma associada ao cartão correto (o titular do lançamento pode não ser
 *    o do cartão principal, se a fatura tiver cartões adicionais) e
 *    marcada com `source: "IMPORT"`.
 *    Observação: aqui usamos `new Date(t.date)` diretamente (não
 *    `parseLocalDate`) porque `t.date` já vem como um ISO completo com
 *    componentes de data/hora construídos localmente pelo parser da
 *    fatura — não é uma string "date-only" simples, então não sofre do
 *    bug de fuso horário que afeta `new Date("YYYY-MM-DD")`.
 * 5. Para as transações importadas que ficaram com alguma categoria,
 *    roda `ensureFixedSubItems` para aplicar as regras automáticas de
 *    sub-itens fixos (ex.: categoria "Viagem").
 *
 * Retorna o id da fatura e a quantidade de transações importadas.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const cardKeys = new Map<string, { holderName: string; lastDigits: string }>();
  cardKeys.set(`${data.primaryCard.holderName}|${data.primaryCard.lastDigits}`, data.primaryCard);
  for (const t of data.transactions) {
    cardKeys.set(`${t.cardHolder}|${t.cardLastDigits}`, {
      holderName: t.cardHolder,
      lastDigits: t.cardLastDigits,
    });
  }

  const cardIdByKey = new Map<string, string>();
  for (const [key, card] of cardKeys) {
    const record = await prisma.creditCard.upsert({
      where: { bank_holderName_lastDigits: { bank: data.bank, ...card } },
      update: {},
      create: { bank: data.bank, ...card },
    });
    cardIdByKey.set(key, record.id);
  }

  const primaryCardId = cardIdByKey.get(
    `${data.primaryCard.holderName}|${data.primaryCard.lastDigits}`,
  )!;

  const invoice = await prisma.invoice.upsert({
    where: {
      creditCardId_referenceMonth: { creditCardId: primaryCardId, referenceMonth: data.referenceMonth },
    },
    update: {
      totalAmount: data.totalAmount,
      minPayment: data.minPayment ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      fileName: data.fileName,
    },
    create: {
      creditCardId: primaryCardId,
      referenceMonth: data.referenceMonth,
      totalAmount: data.totalAmount,
      minPayment: data.minPayment ?? null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      fileName: data.fileName,
    },
  });

  await prisma.transaction.deleteMany({ where: { invoiceId: invoice.id } });

  await prisma.transaction.createMany({
    data: data.transactions.map((t) => ({
      date: new Date(t.date),
      description: t.description,
      amount: t.amount,
      amountUsd: t.amountUsd ?? null,
      type: t.type,
      section: t.section,
      installmentCurrent: t.installmentCurrent ?? null,
      installmentTotal: t.installmentTotal ?? null,
      categoryId: t.categoryId ?? null,
      pendingReturn: t.pendingReturn ?? false,
      // O `?? primaryCardId` é uma rede de segurança inalcançável na prática:
      // `cardIdByKey` foi montado logo acima a partir DESTAS mesmas transações,
      // então a chave sempre existe. Fica como proteção caso a montagem do mapa
      // mude no futuro — e é ignorada na cobertura por não ter como ser testada.
      /* v8 ignore next */
      creditCardId: cardIdByKey.get(`${t.cardHolder}|${t.cardLastDigits}`) ?? primaryCardId,
      invoiceId: invoice.id,
      source: "IMPORT",
    })),
  });

  const categoriesInImport = new Set(data.transactions.map((t) => t.categoryId).filter(Boolean) as string[]);
  if (categoriesInImport.size > 0) {
    const createdTransactions = await prisma.transaction.findMany({
      where: { invoiceId: invoice.id, categoryId: { in: Array.from(categoriesInImport) } },
      select: { id: true, categoryId: true },
    });
    for (const t of createdTransactions) {
      await ensureFixedSubItems(t.id, t.categoryId);
    }
  }

  return NextResponse.json({ invoiceId: invoice.id, transactionsImported: data.transactions.length });
}
