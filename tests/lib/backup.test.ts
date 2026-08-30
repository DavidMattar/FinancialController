import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import {
  BACKUP_APP_NAME,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLE_KEYS,
  BACKUP_TABLE_LABEL,
  backupFileSchema,
  collectBackup,
  countBackup,
  restoreBackup,
  type BackupData,
} from "@/lib/backup";
import { Prisma } from "@/generated/prisma/client";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";

/** Nome do model no Prisma para cada tabela do backup, na ordem de inserção. */
const MODEL_POR_TABELA: Record<keyof BackupData, string> = {
  categories: "category",
  creditCards: "creditCard",
  invoices: "invoice",
  transactions: "transaction",
  transactionItems: "transactionItem",
  investmentHoldings: "investmentHolding",
  dashboardViews: "dashboardView",
  familyTransactions: "familyTransaction",
  rentalSettlements: "rentalSettlement",
  seasonalRentals: "seasonalRental",
  seasonalRentalExpenses: "seasonalRentalExpense",
};

const ISO = "2026-08-29T12:00:00.000Z";

/** Um registro mínimo válido de cada tabela, para montar arquivos de teste. */
const registros = {
  categories: {
    id: "cat-1",
    name: "Alimentação",
    color: "#f97316",
    icon: "utensils",
    kind: "EXPENSE",
    keywords: ["IFOOD"],
    fixedSubItems: [],
    deductsFromFreeSpend: true,
    createdAt: ISO,
    updatedAt: ISO,
  },
  creditCards: {
    id: "card-1",
    bank: "Santander",
    holderName: "DAVID",
    lastDigits: "8258",
    createdAt: ISO,
  },
  invoices: {
    id: "inv-1",
    creditCardId: "card-1",
    referenceMonth: "2026-08",
    closingDate: null,
    dueDate: ISO,
    totalAmount: "2829.29",
    minPayment: "282.92",
    previousBalance: null,
    fileName: "fatura.pdf",
    importedAt: ISO,
  },
  transactions: {
    id: "tx-1",
    date: ISO,
    description: "SUPERMERCADO BH",
    amount: "150.00",
    currency: "BRL",
    amountUsd: null,
    type: "EXPENSE",
    section: "DESPESA",
    installmentCurrent: null,
    installmentTotal: null,
    source: "IMPORT",
    categoryId: "cat-1",
    creditCardId: "card-1",
    invoiceId: "inv-1",
    notes: null,
    pendingReturn: false,
    createdAt: ISO,
    updatedAt: ISO,
  },
  transactionItems: {
    id: "item-1",
    transactionId: "tx-1",
    description: "Arroz",
    amount: "25.90",
    createdAt: ISO,
    updatedAt: ISO,
  },
  investmentHoldings: {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    quantity: "0.12345678",
    avgCostBrl: "1234.56",
    notes: null,
    createdAt: ISO,
    updatedAt: ISO,
  },
  dashboardViews: {
    id: "view-1",
    name: "Últimos 3 meses",
    filters: { from: "2026-06-01", categoryIds: ["cat-1"] },
    isDefault: false,
    createdAt: ISO,
    updatedAt: ISO,
  },
  familyTransactions: {
    id: "fam-1",
    date: ISO,
    description: "Mercado",
    amount: "42.50",
    type: "EXPENSE",
    notes: null,
    createdAt: ISO,
    updatedAt: ISO,
  },
  rentalSettlements: {
    id: "set-1",
    type: "DAVID",
    periodFrom: ISO,
    periodTo: ISO,
    totalAmount: "500.00",
    rentalCount: 1,
    createdAt: ISO,
  },
  seasonalRentals: {
    id: "rent-1",
    platform: "AIRBNB",
    checkIn: ISO,
    checkOut: ISO,
    netAmountReceived: "1000.00",
    cleaningFee: "180.00",
    notes: null,
    nightRateOverrides: { "2026-06-09": 240 },
    transactionId: "tx-1",
    davidSettlementId: "set-1",
    familiaSettlementId: null,
    createdAt: ISO,
    updatedAt: ISO,
  },
  seasonalRentalExpenses: {
    id: "exp-1",
    seasonalRentalId: "rent-1",
    description: "Gás",
    amount: "60.00",
    createdAt: ISO,
  },
} as const;

/** `data` com todas as tabelas vazias. */
function dataVazia(): Record<string, unknown[]> {
  const data: Record<string, unknown[]> = {};
  for (const k of BACKUP_TABLE_KEYS) data[k] = [];
  return data;
}

/** `data` com um registro em cada tabela. */
function dataCompleta(): Record<string, unknown[]> {
  const data: Record<string, unknown[]> = {};
  for (const k of BACKUP_TABLE_KEYS) data[k] = [{ ...registros[k] }];
  return data;
}

function arquivo(data: Record<string, unknown[]> = dataCompleta()) {
  return { formatVersion: BACKUP_FORMAT_VERSION, app: BACKUP_APP_NAME, generatedAt: ISO, data };
}

/**
 * Faz `createMany` devolver `{ count }` como o Prisma real (sem duplicados) e
 * `deleteMany` devolver zero. Sem isso, a leitura de `.count` no código
 * quebraria — o mock genérico devolve `undefined` por padrão.
 */
function prepararGravacao() {
  for (const model of Object.values(MODEL_POR_TABELA)) {
    prisma[model].createMany.mockImplementation(async (args: { data: unknown[] }) => ({
      count: args.data.length,
    }));
    prisma[model].deleteMany.mockResolvedValue({ count: 0 });
  }
}

beforeEach(() => {
  resetPrismaMock();
  prepararGravacao();
});

describe("metadados do formato", () => {
  it("a versão do formato é um inteiro positivo", () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  it("toda tabela do backup tem um rótulo em português", () => {
    for (const k of BACKUP_TABLE_KEYS) {
      expect(BACKUP_TABLE_LABEL[k], k).toBeTruthy();
    }
  });

  it("cobre as 11 tabelas do schema", () => {
    expect(BACKUP_TABLE_KEYS).toHaveLength(11);
  });

  it("categorias vêm antes de transações, e repasses antes de aluguéis (ordem de FK)", () => {
    const ordem = BACKUP_TABLE_KEYS as readonly string[];
    expect(ordem.indexOf("categories")).toBeLessThan(ordem.indexOf("transactions"));
    expect(ordem.indexOf("creditCards")).toBeLessThan(ordem.indexOf("invoices"));
    expect(ordem.indexOf("invoices")).toBeLessThan(ordem.indexOf("transactions"));
    expect(ordem.indexOf("transactions")).toBeLessThan(ordem.indexOf("transactionItems"));
    expect(ordem.indexOf("rentalSettlements")).toBeLessThan(ordem.indexOf("seasonalRentals"));
    expect(ordem.indexOf("seasonalRentals")).toBeLessThan(
      ordem.indexOf("seasonalRentalExpenses"),
    );
  });
});

describe("countBackup", () => {
  it("conta os registros de cada tabela", () => {
    const contagem = countBackup(dataCompleta() as unknown as BackupData);
    for (const k of BACKUP_TABLE_KEYS) expect(contagem[k]).toBe(1);
  });

  it("conta zero em backup vazio", () => {
    const contagem = countBackup(dataVazia() as unknown as BackupData);
    expect(Object.values(contagem).every((n) => n === 0)).toBe(true);
  });

  it("tem uma chave para cada tabela, mesmo vazia", () => {
    expect(Object.keys(countBackup(dataVazia() as unknown as BackupData))).toEqual([
      ...BACKUP_TABLE_KEYS,
    ]);
  });
});

describe("collectBackup", () => {
  beforeEach(() => {
    for (const model of Object.values(MODEL_POR_TABELA)) {
      prisma[model].findMany.mockResolvedValue([]);
    }
  });

  it("lê todas as tabelas do banco", async () => {
    await collectBackup();
    for (const model of Object.values(MODEL_POR_TABELA)) {
      expect(prisma[model].findMany, model).toHaveBeenCalledTimes(1);
    }
  });

  it("monta o envelope com versão, app, data de geração e contagens", async () => {
    prisma.category.findMany.mockResolvedValue([registros.categories]);
    const backup = await collectBackup();

    expect(backup.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.app).toBe(BACKUP_APP_NAME);
    expect(backup.generatedAt).toBeTruthy();
    expect(backup.counts?.categories).toBe(1);
    expect(backup.counts?.transactions).toBe(0);
    expect(backup.data.categories).toHaveLength(1);
  });

  it("não usa include (só campos escalares + colunas de FK)", async () => {
    await collectBackup();
    for (const model of Object.values(MODEL_POR_TABELA)) {
      const args = prisma[model].findMany.mock.calls[0][0];
      expect(args, model).not.toHaveProperty("include");
      expect(args, model).toHaveProperty("orderBy");
    }
  });

  it("a data de geração é um ISO válido", async () => {
    const backup = await collectBackup();
    expect(Number.isNaN(Date.parse(backup.generatedAt!))).toBe(false);
  });

  it("as contagens conferem com o conteúdo de data", async () => {
    prisma.transaction.findMany.mockResolvedValue([registros.transactions, registros.transactions]);
    const backup = await collectBackup();
    expect(backup.counts?.transactions).toBe(backup.data.transactions.length);
  });
});

describe("backupFileSchema", () => {
  it("aceita um arquivo completo válido", () => {
    const r = backupFileSchema.safeParse(arquivo());
    expect(r.success).toBe(true);
  });

  it("aceita um arquivo com todas as tabelas vazias", () => {
    expect(backupFileSchema.safeParse(arquivo(dataVazia())).success).toBe(true);
  });

  it("aceita 'data' sem nenhuma tabela declarada (todas viram [])", () => {
    const r = backupFileSchema.safeParse({ formatVersion: 1, data: {} });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.data.transactions).toEqual([]);
      expect(r.data.data.categories).toEqual([]);
    }
  });

  it("recusa arquivo sem formatVersion", () => {
    const r = backupFileSchema.safeParse({ data: dataVazia() });
    expect(r.success).toBe(false);
  });

  it("recusa arquivo sem data", () => {
    expect(backupFileSchema.safeParse({ formatVersion: 1 }).success).toBe(false);
  });

  it("recusa formatVersion não inteiro ou não positivo", () => {
    expect(backupFileSchema.safeParse({ formatVersion: 1.5, data: {} }).success).toBe(false);
    expect(backupFileSchema.safeParse({ formatVersion: 0, data: {} }).success).toBe(false);
  });

  it("recusa data/hora inválida", () => {
    const data = dataCompleta();
    data.categories = [{ ...registros.categories, createdAt: "não é data" }];
    expect(backupFileSchema.safeParse(arquivo(data)).success).toBe(false);
  });

  it("recusa id vazio", () => {
    const data = dataCompleta();
    data.categories = [{ ...registros.categories, id: "" }];
    expect(backupFileSchema.safeParse(arquivo(data)).success).toBe(false);
  });

  it("recusa enum fora dos valores do schema", () => {
    const data = dataCompleta();
    data.transactions = [{ ...registros.transactions, type: "TRANSFERENCIA" }];
    expect(backupFileSchema.safeParse(arquivo(data)).success).toBe(false);
  });

  it("normaliza valor monetário numérico para string (não perde precisão)", () => {
    const data = dataVazia();
    data.transactions = [{ ...registros.transactions, amount: 42.5 }];
    const r = backupFileSchema.safeParse(arquivo(data));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data.transactions[0].amount).toBe("42.5");
  });

  it("aplica os padrões dos campos opcionais", () => {
    const data = dataVazia();
    data.categories = [
      {
        id: "cat-2",
        name: "Sem opcionais",
        color: "#000",
        icon: "tag",
        kind: "EXPENSE",
        createdAt: ISO,
        updatedAt: ISO,
      },
    ];
    const r = backupFileSchema.safeParse(arquivo(data));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.data.categories[0].keywords).toEqual([]);
      expect(r.data.data.categories[0].fixedSubItems).toEqual([]);
      expect(r.data.data.categories[0].deductsFromFreeSpend).toBe(false);
    }
  });

  it("aceita campos nulos onde o schema permite", () => {
    const data = dataVazia();
    data.transactions = [
      {
        ...registros.transactions,
        amountUsd: null,
        section: null,
        categoryId: null,
        creditCardId: null,
        invoiceId: null,
        notes: null,
        installmentCurrent: null,
        installmentTotal: null,
      },
    ];
    expect(backupFileSchema.safeParse(arquivo(data)).success).toBe(true);
  });

  it("aceita metadados ausentes (app, generatedAt, counts)", () => {
    expect(backupFileSchema.safeParse({ formatVersion: 1, data: dataVazia() }).success).toBe(true);
  });

  it("aceita registro sem a chave de Json livre (arquivo antigo ou editado à mão)", () => {
    // No Zod 4 um `z.unknown()` puro recusa a chave ausente, então estes dois
    // campos precisam ser `.optional()` no schema — é o que este teste trava.
    const data = dataVazia();
    const aluguelSemJson = { ...registros.seasonalRentals } as Record<string, unknown>;
    delete aluguelSemJson.nightRateOverrides;
    const viewSemFiltros = { ...registros.dashboardViews } as Record<string, unknown>;
    delete viewSemFiltros.filters;
    data.seasonalRentals = [aluguelSemJson];
    data.dashboardViews = [viewSemFiltros];

    expect(backupFileSchema.safeParse(arquivo(data)).success).toBe(true);
  });
});

describe("restoreBackup — modo replace", () => {
  it("apaga tudo antes de inserir", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    for (const model of Object.values(MODEL_POR_TABELA)) {
      expect(prisma[model].deleteMany, model).toHaveBeenCalledTimes(1);
    }
  });

  it("apaga filho antes de pai (senão a FK seria violada no meio)", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    const ordemDe = (model: string) => prisma[model].deleteMany.mock.invocationCallOrder[0];
    expect(ordemDe("transactionItem")).toBeLessThan(ordemDe("transaction"));
    expect(ordemDe("transaction")).toBeLessThan(ordemDe("invoice"));
    expect(ordemDe("invoice")).toBeLessThan(ordemDe("creditCard"));
    expect(ordemDe("transaction")).toBeLessThan(ordemDe("category"));
    expect(ordemDe("seasonalRentalExpense")).toBeLessThan(ordemDe("seasonalRental"));
    expect(ordemDe("seasonalRental")).toBeLessThan(ordemDe("rentalSettlement"));
  });

  it("insere pai antes de filho", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    const ordemDe = (model: string) => prisma[model].createMany.mock.invocationCallOrder[0];
    expect(ordemDe("category")).toBeLessThan(ordemDe("transaction"));
    expect(ordemDe("creditCard")).toBeLessThan(ordemDe("invoice"));
    expect(ordemDe("invoice")).toBeLessThan(ordemDe("transaction"));
    expect(ordemDe("transaction")).toBeLessThan(ordemDe("transactionItem"));
    // O aluguel aponta para o repasse, então o repasse entra primeiro.
    expect(ordemDe("rentalSettlement")).toBeLessThan(ordemDe("seasonalRental"));
    expect(ordemDe("seasonalRental")).toBeLessThan(ordemDe("seasonalRentalExpense"));
  });

  it("apaga tudo antes de qualquer inserção", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    const ultimoDelete = Math.max(
      ...Object.values(MODEL_POR_TABELA).map(
        (m) => prisma[m].deleteMany.mock.invocationCallOrder[0],
      ),
    );
    const primeiroInsert = Math.min(
      ...Object.values(MODEL_POR_TABELA).map(
        (m) => prisma[m].createMany.mock.invocationCallOrder[0],
      ),
    );
    expect(ultimoDelete).toBeLessThan(primeiroInsert);
  });

  it("devolve o que foi inserido e o que o arquivo tinha", async () => {
    const r = await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    expect(r.mode).toBe("replace");
    expect(r.totalInserted).toBe(11);
    expect(r.inserted.categories).toBe(1);
    expect(r.fileCounts.categories).toBe(1);
  });

  it("roda tudo dentro de uma transação, com timeout maior que o padrão", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "replace");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const opcoes = prisma.$transaction.mock.calls[0][1];
    expect(opcoes.timeout).toBeGreaterThan(5_000);
    expect(opcoes.maxWait).toBeGreaterThan(0);
  });

  it("um arquivo vazio esvazia o banco e insere nada", async () => {
    const r = await restoreBackup(backupFileSchema.parse(arquivo(dataVazia())), "replace");

    expect(r.totalInserted).toBe(0);
    expect(prisma.transaction.deleteMany).toHaveBeenCalled();
  });

  it("propaga a falha da transação (nada foi gravado)", async () => {
    prisma.$transaction.mockRejectedValue(new Error("FK violada"));
    await expect(
      restoreBackup(backupFileSchema.parse(arquivo()), "replace"),
    ).rejects.toThrow("FK violada");
  });
});

describe("restoreBackup — modo merge", () => {
  it("não apaga nada", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "merge");

    for (const model of Object.values(MODEL_POR_TABELA)) {
      expect(prisma[model].deleteMany, model).not.toHaveBeenCalled();
    }
  });

  it("insere as mesmas tabelas do replace", async () => {
    const r = await restoreBackup(backupFileSchema.parse(arquivo()), "merge");
    expect(r.mode).toBe("merge");
    expect(r.totalInserted).toBe(11);
  });

  it("reporta zero inserido quando o banco já tem tudo (skipDuplicates)", async () => {
    for (const model of Object.values(MODEL_POR_TABELA)) {
      prisma[model].createMany.mockResolvedValue({ count: 0 });
    }
    const r = await restoreBackup(backupFileSchema.parse(arquivo()), "merge");
    expect(r.totalInserted).toBe(0);
    // O arquivo continua reportando o que tinha.
    expect(r.fileCounts.categories).toBe(1);
  });
});

describe("restoreBackup — conversão dos valores", () => {
  async function inserirEObter(model: string, data = dataCompleta()) {
    await restoreBackup(backupFileSchema.parse(arquivo(data)), "merge");
    return prisma[model].createMany.mock.calls[0][0];
  }

  it("usa skipDuplicates em todas as tabelas", async () => {
    await restoreBackup(backupFileSchema.parse(arquivo()), "merge");
    for (const model of Object.values(MODEL_POR_TABELA)) {
      expect(prisma[model].createMany.mock.calls[0][0].skipDuplicates, model).toBe(true);
    }
  });

  it("preserva os ids do arquivo (o que mantém as relações)", async () => {
    const args = await inserirEObter("transaction");
    expect(args.data[0].id).toBe("tx-1");
    expect(args.data[0].categoryId).toBe("cat-1");
    expect(args.data[0].invoiceId).toBe("inv-1");
    expect(args.data[0].creditCardId).toBe("card-1");
  });

  it("converte timestamps ISO de volta para Date", async () => {
    const args = await inserirEObter("transaction");
    expect(args.data[0].date).toBeInstanceOf(Date);
    expect(args.data[0].date.toISOString()).toBe(ISO);
    expect(args.data[0].createdAt).toBeInstanceOf(Date);
    expect(args.data[0].updatedAt).toBeInstanceOf(Date);
  });

  it("mantém o updatedAt do arquivo (não deixa o Prisma sobrescrever)", async () => {
    const data = dataCompleta();
    data.transactions = [{ ...registros.transactions, updatedAt: "2020-01-02T03:04:05.000Z" }];
    const args = await inserirEObter("transaction", data);
    expect(args.data[0].updatedAt.toISOString()).toBe("2020-01-02T03:04:05.000Z");
  });

  it("mantém valores monetários como string (não passa por float)", async () => {
    const args = await inserirEObter("investmentHolding");
    expect(args.data[0].quantity).toBe("0.12345678");
    expect(args.data[0].avgCostBrl).toBe("1234.56");
  });

  it("converte data opcional nula para null e preenchida para Date", async () => {
    const args = await inserirEObter("invoice");
    expect(args.data[0].closingDate).toBeNull();
    expect(args.data[0].dueDate).toBeInstanceOf(Date);
  });

  it("converte campo opcional ausente para null", async () => {
    const data = dataCompleta();
    const semOpcionais = { ...registros.invoices } as Record<string, unknown>;
    delete semOpcionais.minPayment;
    delete semOpcionais.previousBalance;
    delete semOpcionais.closingDate;
    data.invoices = [semOpcionais];
    const args = await inserirEObter("invoice", data);
    expect(args.data[0].minPayment).toBeNull();
    expect(args.data[0].previousBalance).toBeNull();
    expect(args.data[0].closingDate).toBeNull();
  });

  it("grava o Json de diárias customizadas como está", async () => {
    const args = await inserirEObter("seasonalRental");
    expect(args.data[0].nightRateOverrides).toEqual({ "2026-06-09": 240 });
  });

  it("usa Prisma.DbNull quando o Json é nulo (o Prisma recusa null cru)", async () => {
    const data = dataCompleta();
    data.seasonalRentals = [{ ...registros.seasonalRentals, nightRateOverrides: null }];
    const args = await inserirEObter("seasonalRental", data);
    expect(args.data[0].nightRateOverrides).toBe(Prisma.DbNull);
  });

  it("usa Prisma.DbNull quando o Json está ausente", async () => {
    const data = dataCompleta();
    const semJson = { ...registros.seasonalRentals } as Record<string, unknown>;
    delete semJson.nightRateOverrides;
    data.seasonalRentals = [semJson];
    const args = await inserirEObter("seasonalRental", data);
    expect(args.data[0].nightRateOverrides).toBe(Prisma.DbNull);
  });

  it("preserva a soft reference para a transação de receita do aluguel", async () => {
    const args = await inserirEObter("seasonalRental");
    expect(args.data[0].transactionId).toBe("tx-1");
    expect(args.data[0].davidSettlementId).toBe("set-1");
    expect(args.data[0].familiaSettlementId).toBeNull();
  });

  it("grava os filtros de uma view salva como Json", async () => {
    const args = await inserirEObter("dashboardView");
    expect(args.data[0].filters).toEqual({ from: "2026-06-01", categoryIds: ["cat-1"] });
  });

  it("usa objeto vazio quando a view salva não tem filtros", async () => {
    const data = dataCompleta();
    const semFiltros = { ...registros.dashboardViews } as Record<string, unknown>;
    delete semFiltros.filters;
    data.dashboardViews = [semFiltros];
    const args = await inserirEObter("dashboardView", data);
    expect(args.data[0].filters).toEqual({});
  });

  it("preserva os arrays e flags de uma categoria", async () => {
    const args = await inserirEObter("category");
    expect(args.data[0].keywords).toEqual(["IFOOD"]);
    expect(args.data[0].fixedSubItems).toEqual([]);
    expect(args.data[0].deductsFromFreeSpend).toBe(true);
    expect(args.data[0].kind).toBe("EXPENSE");
  });

  it("preserva parcelas, seção e flag de devolução da transação", async () => {
    const data = dataCompleta();
    data.transactions = [
      {
        ...registros.transactions,
        installmentCurrent: 2,
        installmentTotal: 10,
        section: "PARCELAMENTO",
        pendingReturn: true,
        amountUsd: "20.50",
        notes: "uma nota",
        currency: "USD",
      },
    ];
    const args = await inserirEObter("transaction", data);
    expect(args.data[0]).toMatchObject({
      installmentCurrent: 2,
      installmentTotal: 10,
      section: "PARCELAMENTO",
      pendingReturn: true,
      amountUsd: "20.50",
      notes: "uma nota",
      currency: "USD",
    });
  });

  it("preserva o tipo e a contagem de um repasse", async () => {
    const args = await inserirEObter("rentalSettlement");
    expect(args.data[0]).toMatchObject({
      type: "DAVID",
      totalAmount: "500.00",
      rentalCount: 1,
    });
    expect(args.data[0].periodFrom).toBeInstanceOf(Date);
  });

  it("preserva o vínculo de um gasto extra com o aluguel", async () => {
    const args = await inserirEObter("seasonalRentalExpense");
    expect(args.data[0]).toMatchObject({
      id: "exp-1",
      seasonalRentalId: "rent-1",
      description: "Gás",
      amount: "60.00",
    });
  });

  it("preserva os campos do ledger Família (que é isolado do resto)", async () => {
    const args = await inserirEObter("familyTransaction");
    expect(args.data[0]).toMatchObject({
      id: "fam-1",
      description: "Mercado",
      amount: "42.50",
      type: "EXPENSE",
    });
  });

  it("preserva o vínculo do sub-item com a transação", async () => {
    const args = await inserirEObter("transactionItem");
    expect(args.data[0]).toMatchObject({ id: "item-1", transactionId: "tx-1", amount: "25.90" });
  });

  it("preserva os dados do cartão", async () => {
    const args = await inserirEObter("creditCard");
    expect(args.data[0]).toMatchObject({
      id: "card-1",
      bank: "Santander",
      holderName: "DAVID",
      lastDigits: "8258",
    });
  });
});

describe("restoreBackup — campos opcionais", () => {
  it("grava null em todo campo opcional que veio nulo no arquivo", async () => {
    const data = dataCompleta();
    data.transactions = [
      {
        ...registros.transactions,
        amountUsd: null,
        section: null,
        installmentCurrent: null,
        installmentTotal: null,
        categoryId: null,
        creditCardId: null,
        invoiceId: null,
        notes: null,
      },
    ];
    data.investmentHoldings = [{ ...registros.investmentHoldings, notes: null }];
    data.familyTransactions = [{ ...registros.familyTransactions, notes: null }];
    data.seasonalRentals = [
      {
        ...registros.seasonalRentals,
        notes: null,
        transactionId: null,
        davidSettlementId: null,
        familiaSettlementId: null,
      },
    ];

    await restoreBackup(backupFileSchema.parse(arquivo(data)), "merge");

    const transacao = prisma.transaction.createMany.mock.calls[0][0].data[0];
    expect(transacao).toMatchObject({
      amountUsd: null,
      section: null,
      installmentCurrent: null,
      installmentTotal: null,
      categoryId: null,
      creditCardId: null,
      invoiceId: null,
      notes: null,
    });
    expect(prisma.investmentHolding.createMany.mock.calls[0][0].data[0].notes).toBeNull();
    expect(prisma.familyTransaction.createMany.mock.calls[0][0].data[0].notes).toBeNull();
    expect(prisma.seasonalRental.createMany.mock.calls[0][0].data[0]).toMatchObject({
      notes: null,
      transactionId: null,
      davidSettlementId: null,
      familiaSettlementId: null,
    });
  });

  it("preserva todo campo opcional que veio preenchido no arquivo", async () => {
    const data = dataCompleta();
    data.investmentHoldings = [{ ...registros.investmentHoldings, notes: "compra longo prazo" }];
    data.familyTransactions = [{ ...registros.familyTransactions, notes: "feira da semana" }];
    data.seasonalRentals = [
      {
        ...registros.seasonalRentals,
        notes: "hóspede recorrente",
        familiaSettlementId: "set-2",
      },
    ];

    await restoreBackup(backupFileSchema.parse(arquivo(data)), "merge");

    expect(prisma.investmentHolding.createMany.mock.calls[0][0].data[0].notes).toBe(
      "compra longo prazo",
    );
    expect(prisma.familyTransaction.createMany.mock.calls[0][0].data[0].notes).toBe(
      "feira da semana",
    );
    expect(prisma.seasonalRental.createMany.mock.calls[0][0].data[0]).toMatchObject({
      notes: "hóspede recorrente",
      familiaSettlementId: "set-2",
    });
  });

  it("preserva as datas opcionais da fatura quando vêm preenchidas", async () => {
    const data = dataCompleta();
    data.invoices = [
      { ...registros.invoices, closingDate: ISO, minPayment: "100.00", previousBalance: "50.00" },
    ];

    await restoreBackup(backupFileSchema.parse(arquivo(data)), "merge");

    const fatura = prisma.invoice.createMany.mock.calls[0][0].data[0];
    expect(fatura.closingDate).toBeInstanceOf(Date);
    expect(fatura.minPayment).toBe("100.00");
    expect(fatura.previousBalance).toBe("50.00");
  });
});

describe("restoreBackup — ida e volta", () => {
  it("o que collectBackup gera é aceito pelo schema de restauração", async () => {
    for (const [tabela, model] of Object.entries(MODEL_POR_TABELA)) {
      prisma[model].findMany.mockResolvedValue([registros[tabela as keyof BackupData]]);
    }
    const backup = await collectBackup();
    // Passa por JSON como acontece de verdade (download + upload do arquivo).
    const comoArquivo = JSON.parse(JSON.stringify(backup));
    const r = backupFileSchema.safeParse(comoArquivo);
    expect(r.success).toBe(true);
  });
});
