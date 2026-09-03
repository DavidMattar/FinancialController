/**
 * Backup completo do banco em um único arquivo JSON — exportação
 * (`collectBackup`) e restauração (`restoreBackup`).
 *
 * Para que serve: o app é local-first e de um único usuário, então não existe
 * backup automático de nuvem. Este módulo permite baixar um retrato de TODOS
 * os dados antes de mexer em algo que afete o banco (uma mudança de schema, um
 * `prisma db push` arriscado, um teste em massa) e depois recuperá-los sem
 * precisar de `pg_dump`/`psql`.
 *
 * Decisões de design importantes:
 * - **Os `id` (cuid) são preservados.** Sem isso as relações entre as tabelas
 *   (categoria de uma transação, fatura de um lançamento, aluguel de um gasto
 *   extra) se perderiam na restauração. É também o que permite que uma
 *   restauração seja idempotente: restaurar o mesmo arquivo duas vezes não
 *   duplica nada.
 * - **A ordem de inserção respeita as chaves estrangeiras** (ver
 *   `insertBackup`): pai antes de filho. `RentalSettlement` entra ANTES de
 *   `SeasonalRental`, porque é o aluguel que aponta para o repasse
 *   (davidSettlementId/familiaSettlementId), e não o contrário.
 * - **Nada é recalculado na restauração.** O backup guarda só o que o banco
 *   guarda; valores derivados (tableValue do aluguel, orçamento 15/10/75,
 *   cotação de investimento) continuam sendo recalculados na leitura como
 *   sempre — restaurar um backup antigo com uma tabela de preços nova é,
 *   portanto, seguro e esperado.
 * - **Datas viajam como timestamp ISO completo** (ex:
 *   `2026-08-29T14:03:00.000Z`), não como "YYYY-MM-DD". Por isso o `new Date()`
 *   usado aqui não cai na armadilha de fuso descrita em `dateOnly.ts`: aquela
 *   vale para strings de data pura, que o JS interpreta como UTC meia-noite.
 *   Um ISO completo já tem o instante exato embutido e faz round-trip perfeito.
 * - **Valores `Decimal` viajam como string** (é assim que o `JSON.stringify`
 *   serializa o Decimal do Prisma) e voltam ao Prisma como string também, para
 *   não perder precisão passando por `number`.
 * - **Formato 2 (compras de investimento).** Até o formato 1, um
 *   `InvestmentHolding` carregava `quantity`/`avgCostBrl` como colunas. Agora
 *   quem guarda isso é `InvestmentPurchase` (uma linha por compra), e o total
 *   da posição é derivado delas. Um arquivo do formato 1 continua restaurável:
 *   os dois campos antigos ainda são aceitos no schema e viram UMA compra
 *   equivalente na restauração (ver `legacyPurchasesFromHoldings`).
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Versão do formato do arquivo. Se um dia o formato mudar de forma
 * incompatível, incremente aqui — a restauração recusa arquivos com versão
 * MAIOR que esta (arquivo gerado por uma versão mais nova do app).
 */
export const BACKUP_FORMAT_VERSION = 2;

/** Marca gravada no arquivo, só para deixar claro de qual app ele veio. */
export const BACKUP_APP_NAME = "FinancialController";

// ---------------------------------------------------------------------------
// Schema de validação (zod) do arquivo de backup
// ---------------------------------------------------------------------------

/** Timestamp ISO completo; recusa qualquer string que o JS não saiba ler. */
const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "data/hora inválida" });

const nullableIsoDateTime = isoDateTime.nullish();

/**
 * Um valor monetário do backup. O Prisma serializa `Decimal` como string, mas
 * um arquivo editado à mão pode trazer número — aceita os dois e normaliza
 * para string, que é o que o Prisma recebe de volta sem perder precisão.
 */
const decimalValue = z.union([z.string(), z.number()]).transform(String);

const nullableDecimalValue = decimalValue.nullish();

const idValue = z.string().min(1);

const categorySchema = z.object({
  id: idValue,
  name: z.string().min(1),
  color: z.string(),
  icon: z.string(),
  kind: z.enum(["EXPENSE", "INCOME"]),
  keywords: z.array(z.string()).default([]),
  fixedSubItems: z.array(z.string()).default([]),
  deductsFromFreeSpend: z.boolean().default(false),
  // Ordem escolhida pelo usuário na tela de Categorias. Tem padrão porque
  // arquivo gerado antes desta coluna existir não a traz — e 0 em todas
  // devolve a lista à ordem alfabética, que é o que aquele backup descrevia.
  // Sem o campo aqui o zod DESCARTARIA a chave e a restauração perderia a
  // ordem de um backup que a tinha.
  sortOrder: z.number().int().default(0),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const creditCardSchema = z.object({
  id: idValue,
  bank: z.string(),
  holderName: z.string(),
  lastDigits: z.string(),
  createdAt: isoDateTime,
});

const invoiceSchema = z.object({
  id: idValue,
  creditCardId: idValue,
  referenceMonth: z.string(),
  closingDate: nullableIsoDateTime,
  dueDate: nullableIsoDateTime,
  totalAmount: decimalValue,
  minPayment: nullableDecimalValue,
  previousBalance: nullableDecimalValue,
  fileName: z.string(),
  importedAt: isoDateTime,
});

const transactionSchema = z.object({
  id: idValue,
  date: isoDateTime,
  description: z.string(),
  amount: decimalValue,
  currency: z.string().default("BRL"),
  amountUsd: nullableDecimalValue,
  type: z.enum(["EXPENSE", "INCOME", "PAYMENT"]),
  section: z.enum(["DESPESA", "CREDITO", "PARCELAMENTO"]).nullish(),
  installmentCurrent: z.number().int().nullish(),
  installmentTotal: z.number().int().nullish(),
  source: z.enum(["MANUAL", "IMPORT"]),
  categoryId: z.string().nullish(),
  creditCardId: z.string().nullish(),
  invoiceId: z.string().nullish(),
  notes: z.string().nullish(),
  pendingReturn: z.boolean().default(false),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const transactionItemSchema = z.object({
  id: idValue,
  transactionId: idValue,
  description: z.string(),
  amount: decimalValue,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const investmentHoldingSchema = z.object({
  id: idValue,
  type: z.enum(["CRYPTO", "CURRENCY"]),
  symbol: z.string(),
  name: z.string(),
  notes: z.string().nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /**
   * LEGADO do formato 1, quando a posição guardava o total e o custo médio em
   * colunas próprias. Hoje isso vive em `investmentPurchases`; os dois campos
   * continuam aceitos aqui (opcionais) só para um arquivo antigo não perder a
   * posição na restauração — `legacyPurchasesFromHoldings` os converte em uma
   * compra equivalente. Backup gerado a partir do formato 2 não os traz.
   */
  quantity: nullableDecimalValue,
  avgCostBrl: nullableDecimalValue,
});

/** Uma compra individual de um ativo (ver model InvestmentPurchase). */
const investmentPurchaseSchema = z.object({
  id: idValue,
  holdingId: idValue,
  quantity: decimalValue,
  unitCostBrl: decimalValue,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const dashboardViewSchema = z.object({
  id: idValue,
  name: z.string(),
  // Json livre (o conjunto de filtros salvo) — não tem forma fixa, de
  // propósito. O `.optional()` é obrigatório: no Zod 4 um `z.unknown()` puro
  // ainda EXIGE a chave presente (recusa `undefined`), o que faria o schema
  // rejeitar um arquivo em que a chave simplesmente não existe.
  filters: z.unknown().optional(),
  isDefault: z.boolean().default(false),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const familyTransactionSchema = z.object({
  id: idValue,
  date: isoDateTime,
  description: z.string(),
  amount: decimalValue,
  type: z.enum(["EXPENSE", "INCOME"]),
  notes: z.string().nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const rentalSettlementSchema = z.object({
  id: idValue,
  type: z.enum(["DAVID", "FAMILIA", "LIMPEZA"]),
  periodFrom: isoDateTime,
  periodTo: isoDateTime,
  totalAmount: decimalValue,
  rentalCount: z.number().int(),
  createdAt: isoDateTime,
});

const seasonalRentalSchema = z.object({
  id: idValue,
  platform: z.enum(["AIRBNB", "BOOKING"]),
  checkIn: isoDateTime,
  checkOut: isoDateTime,
  netAmountReceived: decimalValue,
  cleaningFee: decimalValue,
  notes: z.string().nullish(),
  // Json livre { "YYYY-MM-DD": valor } — ver SeasonalRental.nightRateOverrides.
  // `.optional()` pelo mesmo motivo de `DashboardView.filters` acima: sem ele,
  // um arquivo sem essa chave (ex: gerado antes da feature de diárias
  // customizadas existir) seria recusado inteiro.
  nightRateOverrides: z.unknown().optional(),
  transactionId: z.string().nullish(),
  davidSettlementId: z.string().nullish(),
  familiaSettlementId: z.string().nullish(),
  // `.nullish()` (e não obrigatório) para um backup gerado antes da trilha de
  // limpeza existir continuar restaurável — mesmo motivo de `nightRateOverrides`.
  limpezaSettlementId: z.string().nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const seasonalRentalExpenseSchema = z.object({
  id: idValue,
  seasonalRentalId: idValue,
  description: z.string(),
  amount: decimalValue,
  createdAt: isoDateTime,
});

/**
 * As tabelas do backup, já na ORDEM DE INSERÇÃO correta (pai antes de filho).
 * Cada tabela é opcional e tem `[]` como padrão, então um backup gerado antes
 * de um model novo existir continua restaurável.
 */
const backupDataSchema = z.object({
  categories: z.array(categorySchema).default([]),
  creditCards: z.array(creditCardSchema).default([]),
  invoices: z.array(invoiceSchema).default([]),
  transactions: z.array(transactionSchema).default([]),
  transactionItems: z.array(transactionItemSchema).default([]),
  investmentHoldings: z.array(investmentHoldingSchema).default([]),
  investmentPurchases: z.array(investmentPurchaseSchema).default([]),
  dashboardViews: z.array(dashboardViewSchema).default([]),
  familyTransactions: z.array(familyTransactionSchema).default([]),
  rentalSettlements: z.array(rentalSettlementSchema).default([]),
  seasonalRentals: z.array(seasonalRentalSchema).default([]),
  seasonalRentalExpenses: z.array(seasonalRentalExpenseSchema).default([]),
});

/** Schema do arquivo inteiro (envelope de metadados + `data`). */
export const backupFileSchema = z.object({
  formatVersion: z.number().int().positive(),
  app: z.string().optional(),
  generatedAt: isoDateTime.optional(),
  /**
   * Contagem por tabela. É redundante com `data` de propósito: deixa a tela de
   * restauração mostrar um resumo do arquivo (e o usuário conferir se pegou o
   * arquivo certo) sem precisar percorrer todos os registros.
   */
  counts: z.record(z.string(), z.number()).optional(),
  data: backupDataSchema,
});

export type BackupData = z.infer<typeof backupDataSchema>;
export type BackupFile = z.infer<typeof backupFileSchema>;

/** Nomes das tabelas do backup, na ordem de inserção. */
export const BACKUP_TABLE_KEYS = [
  "categories",
  "creditCards",
  "invoices",
  "transactions",
  "transactionItems",
  "investmentHoldings",
  "investmentPurchases",
  "dashboardViews",
  "familyTransactions",
  "rentalSettlements",
  "seasonalRentals",
  "seasonalRentalExpenses",
] as const satisfies readonly (keyof BackupData)[];

/** Rótulo em português de cada tabela, para exibir no resumo na tela. */
export const BACKUP_TABLE_LABEL: Record<keyof BackupData, string> = {
  categories: "Categorias",
  creditCards: "Cartões de crédito",
  invoices: "Faturas",
  transactions: "Transações",
  transactionItems: "Sub-itens de transação",
  investmentHoldings: "Investimentos",
  investmentPurchases: "Compras de investimento",
  dashboardViews: "Views salvas",
  familyTransactions: "Transações Família",
  rentalSettlements: "Repasses de aluguel",
  seasonalRentals: "Aluguéis de temporada",
  seasonalRentalExpenses: "Gastos extras de aluguel",
};

/** Quantos registros existem em cada tabela de um backup. */
export function countBackup(data: BackupData): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of BACKUP_TABLE_KEYS) counts[key] = data[key].length;
  return counts;
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/**
 * Lê TODAS as tabelas do banco e monta o objeto do arquivo de backup.
 *
 * Usa `findMany()` sem `include`, então cada registro sai só com seus campos
 * escalares — inclusive as colunas de chave estrangeira (`categoryId`,
 * `invoiceId`, ...), que é exatamente o que a restauração precisa. Objetos de
 * relação aninhados seriam ruído e ainda duplicariam dados dentro do arquivo.
 *
 * A serialização dos tipos especiais fica por conta do `JSON.stringify` na
 * rota: `Decimal` vira string e `Date` vira timestamp ISO.
 */
export async function collectBackup(): Promise<BackupFile> {
  const [
    categories,
    creditCards,
    invoices,
    transactions,
    transactionItems,
    investmentHoldings,
    investmentPurchases,
    dashboardViews,
    familyTransactions,
    rentalSettlements,
    seasonalRentals,
    seasonalRentalExpenses,
  ] = await Promise.all([
    prisma.category.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.creditCard.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.invoice.findMany({ orderBy: { importedAt: "asc" } }),
    prisma.transaction.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.transactionItem.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.investmentHolding.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.investmentPurchase.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.dashboardView.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.familyTransaction.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.rentalSettlement.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.seasonalRental.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.seasonalRentalExpense.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  // O cast existe porque os tipos do Prisma (Decimal/Date) só se tornam
  // string/ISO depois do JSON.stringify — o conteúdo é exatamente o mesmo.
  const data = {
    categories,
    creditCards,
    invoices,
    transactions,
    transactionItems,
    investmentHoldings,
    investmentPurchases,
    dashboardViews,
    familyTransactions,
    rentalSettlements,
    seasonalRentals,
    seasonalRentalExpenses,
  } as unknown as BackupData;

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    app: BACKUP_APP_NAME,
    generatedAt: new Date().toISOString(),
    counts: countBackup(data),
    data,
  };
}

// ---------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------

/**
 * Como aplicar o arquivo sobre o banco:
 * - `replace`: apaga TUDO e insere o backup — o banco fica idêntico ao momento
 *   em que o arquivo foi gerado. É a restauração de verdade (a que desfaz uma
 *   mudança que deu errado).
 * - `merge`: mantém o que já existe e insere só os registros do arquivo que
 *   ainda não estão no banco (casados por `id`, e por índice único quando for
 *   o caso). Serve para recuperar dados apagados sem perder o que foi lançado
 *   depois do backup.
 */
export type RestoreMode = "replace" | "merge";

export interface RestoreResult {
  mode: RestoreMode;
  /** Quantos registros foram realmente inseridos em cada tabela. */
  inserted: Record<string, number>;
  /** Soma de `inserted`. */
  totalInserted: number;
  /** Quantos registros o arquivo tinha em cada tabela. */
  fileCounts: Record<string, number>;
}

/** Converte um timestamp ISO do backup de volta para Date (ver nota de fuso no topo). */
function toDate(value: string): Date {
  return new Date(value);
}

/** Idem, para campos de data opcionais. */
function toNullableDate(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(value);
}

/**
 * Prepara um valor de coluna `Json?` para o Prisma. Coluna Json nullable não
 * aceita `null` cru — o Prisma exige o sentinela `Prisma.DbNull` para gravar
 * NULL de verdade (`null` sozinho seria ambíguo com o valor JSON `null`).
 */
function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

/**
 * Apaga todas as tabelas, na ordem inversa das dependências (filho antes de
 * pai), para nenhuma chave estrangeira ser violada no meio do caminho.
 * Não confia em `onDelete: Cascade`: apagar explicitamente deixa a ordem
 * visível aqui e não muda de comportamento se o schema mudar.
 */
async function wipeAll(tx: Prisma.TransactionClient): Promise<void> {
  await tx.transactionItem.deleteMany();
  await tx.transaction.deleteMany();
  await tx.invoice.deleteMany();
  await tx.creditCard.deleteMany();
  await tx.category.deleteMany();
  await tx.seasonalRentalExpense.deleteMany();
  await tx.seasonalRental.deleteMany();
  await tx.rentalSettlement.deleteMany();
  await tx.familyTransaction.deleteMany();
  await tx.investmentPurchase.deleteMany();
  await tx.investmentHolding.deleteMany();
  await tx.dashboardView.deleteMany();
}

/**
 * Converte as posições de um backup do **formato 1** em compras.
 *
 * No formato 1 a posição guardava `quantity` e `avgCostBrl` em colunas
 * próprias e a compra individual não existia. Restaurar um arquivo desses sem
 * converter deixaria a posição com zero compras — e, como o total agora é a
 * soma delas, ela apareceria zerada na tela: perda de dado silenciosa.
 *
 * A conversão gera UMA compra por posição, com a quantidade total ao custo
 * médio que estava salvo. Não é a mesma informação que teria sido gravada na
 * época (os aportes individuais não existem mais em lugar nenhum), mas é
 * exatamente equivalente em total investido, custo médio e resultado.
 *
 * O id da compra é **derivado do id da posição** (`<holdingId>-legacy`), e não
 * um cuid novo: assim restaurar o mesmo arquivo duas vezes não cria uma
 * segunda compra (o `skipDuplicates` reconhece o id repetido), mantendo a
 * restauração idempotente como no resto deste módulo.
 *
 * Uma posição que já venha com compras no arquivo (formato 2) é ignorada aqui,
 * mesmo que ainda carregue os campos antigos — o dado real ganha do legado.
 */
function legacyPurchasesFromHoldings(data: BackupData) {
  const holdingsComCompra = new Set(data.investmentPurchases.map((p) => p.holdingId));
  return data.investmentHoldings
    .filter((h) => h.quantity != null && h.avgCostBrl != null && !holdingsComCompra.has(h.id))
    .map((h) => ({
      id: `${h.id}-legacy`,
      holdingId: h.id,
      quantity: h.quantity as string,
      unitCostBrl: h.avgCostBrl as string,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }));
}

/**
 * Insere o conteúdo do backup, tabela por tabela, na ordem que as chaves
 * estrangeiras exigem.
 *
 * Todo `createMany` usa `skipDuplicates: true`. No modo `replace` isso nunca
 * dispara (o banco acabou de ser esvaziado); no modo `merge` é o que faz o
 * "só insere o que falta" funcionar tanto para `id` repetido quanto para os
 * índices únicos (nome de categoria, cartão, fatura do mês, etc.).
 */
async function insertBackup(
  tx: Prisma.TransactionClient,
  data: BackupData,
): Promise<Record<string, number>> {
  const inserted: Record<string, number> = {};

  inserted.categories = (
    await tx.category.createMany({
      data: data.categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        kind: c.kind,
        keywords: c.keywords,
        fixedSubItems: c.fixedSubItems,
        deductsFromFreeSpend: c.deductsFromFreeSpend,
        createdAt: toDate(c.createdAt),
        updatedAt: toDate(c.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.creditCards = (
    await tx.creditCard.createMany({
      data: data.creditCards.map((c) => ({
        id: c.id,
        bank: c.bank,
        holderName: c.holderName,
        lastDigits: c.lastDigits,
        createdAt: toDate(c.createdAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.invoices = (
    await tx.invoice.createMany({
      data: data.invoices.map((i) => ({
        id: i.id,
        creditCardId: i.creditCardId,
        referenceMonth: i.referenceMonth,
        closingDate: toNullableDate(i.closingDate),
        dueDate: toNullableDate(i.dueDate),
        totalAmount: i.totalAmount,
        minPayment: i.minPayment ?? null,
        previousBalance: i.previousBalance ?? null,
        fileName: i.fileName,
        importedAt: toDate(i.importedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.transactions = (
    await tx.transaction.createMany({
      data: data.transactions.map((t) => ({
        id: t.id,
        date: toDate(t.date),
        description: t.description,
        amount: t.amount,
        currency: t.currency,
        amountUsd: t.amountUsd ?? null,
        type: t.type,
        section: t.section ?? null,
        installmentCurrent: t.installmentCurrent ?? null,
        installmentTotal: t.installmentTotal ?? null,
        source: t.source,
        categoryId: t.categoryId ?? null,
        creditCardId: t.creditCardId ?? null,
        invoiceId: t.invoiceId ?? null,
        notes: t.notes ?? null,
        pendingReturn: t.pendingReturn,
        createdAt: toDate(t.createdAt),
        updatedAt: toDate(t.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.transactionItems = (
    await tx.transactionItem.createMany({
      data: data.transactionItems.map((i) => ({
        id: i.id,
        transactionId: i.transactionId,
        description: i.description,
        amount: i.amount,
        createdAt: toDate(i.createdAt),
        updatedAt: toDate(i.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.investmentHoldings = (
    await tx.investmentHolding.createMany({
      data: data.investmentHoldings.map((h) => ({
        id: h.id,
        type: h.type,
        symbol: h.symbol,
        name: h.name,
        notes: h.notes ?? null,
        createdAt: toDate(h.createdAt),
        updatedAt: toDate(h.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  // As compras do arquivo, mais as convertidas de um arquivo do formato 1 (que
  // guardava total e custo médio na própria posição).
  inserted.investmentPurchases = (
    await tx.investmentPurchase.createMany({
      data: [...data.investmentPurchases, ...legacyPurchasesFromHoldings(data)].map((p) => ({
        id: p.id,
        holdingId: p.holdingId,
        quantity: p.quantity,
        unitCostBrl: p.unitCostBrl,
        createdAt: toDate(p.createdAt),
        updatedAt: toDate(p.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.dashboardViews = (
    await tx.dashboardView.createMany({
      data: data.dashboardViews.map((v) => ({
        id: v.id,
        name: v.name,
        // `filters` é Json obrigatório: um arquivo sem ele vira objeto vazio.
        filters: (v.filters ?? {}) as Prisma.InputJsonValue,
        isDefault: v.isDefault,
        createdAt: toDate(v.createdAt),
        updatedAt: toDate(v.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.familyTransactions = (
    await tx.familyTransaction.createMany({
      data: data.familyTransactions.map((f) => ({
        id: f.id,
        date: toDate(f.date),
        description: f.description,
        amount: f.amount,
        type: f.type,
        notes: f.notes ?? null,
        createdAt: toDate(f.createdAt),
        updatedAt: toDate(f.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  // Repasses entram ANTES dos aluguéis: é o aluguel que aponta para o repasse.
  inserted.rentalSettlements = (
    await tx.rentalSettlement.createMany({
      data: data.rentalSettlements.map((s) => ({
        id: s.id,
        type: s.type,
        periodFrom: toDate(s.periodFrom),
        periodTo: toDate(s.periodTo),
        totalAmount: s.totalAmount,
        rentalCount: s.rentalCount,
        createdAt: toDate(s.createdAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.seasonalRentals = (
    await tx.seasonalRental.createMany({
      data: data.seasonalRentals.map((r) => ({
        id: r.id,
        platform: r.platform,
        checkIn: toDate(r.checkIn),
        checkOut: toDate(r.checkOut),
        netAmountReceived: r.netAmountReceived,
        cleaningFee: r.cleaningFee,
        notes: r.notes ?? null,
        nightRateOverrides: toNullableJson(r.nightRateOverrides),
        // Soft reference para a Transaction de receita (String pura, sem FK).
        transactionId: r.transactionId ?? null,
        davidSettlementId: r.davidSettlementId ?? null,
        familiaSettlementId: r.familiaSettlementId ?? null,
        limpezaSettlementId: r.limpezaSettlementId ?? null,
        createdAt: toDate(r.createdAt),
        updatedAt: toDate(r.updatedAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  inserted.seasonalRentalExpenses = (
    await tx.seasonalRentalExpense.createMany({
      data: data.seasonalRentalExpenses.map((e) => ({
        id: e.id,
        seasonalRentalId: e.seasonalRentalId,
        description: e.description,
        amount: e.amount,
        createdAt: toDate(e.createdAt),
      })),
      skipDuplicates: true,
    })
  ).count;

  return inserted;
}

/**
 * Aplica um arquivo de backup já validado sobre o banco.
 *
 * Roda inteiro dentro de UMA transação do Postgres: se qualquer tabela falhar
 * (ex: no modo `merge`, uma transação do arquivo que aponta para uma categoria
 * que não existe mais), nada é gravado e o banco fica exatamente como estava.
 * Isso é essencial no modo `replace`, cujo primeiro passo é apagar tudo — sem
 * a transação, uma falha no meio deixaria o usuário sem dado nenhum.
 *
 * O timeout é bem maior que o padrão (5s) porque a restauração faz uma dezena
 * de `deleteMany` + `createMany` em sequência.
 */
export async function restoreBackup(file: BackupFile, mode: RestoreMode): Promise<RestoreResult> {
  const inserted = await prisma.$transaction(
    async (tx) => {
      if (mode === "replace") await wipeAll(tx);
      return insertBackup(tx, file.data);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );

  return {
    mode,
    inserted,
    totalInserted: Object.values(inserted).reduce((sum, n) => sum + n, 0),
    fileCounts: countBackup(file.data),
  };
}
