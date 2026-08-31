import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));
vi.mock("@/lib/pdf", () => ({ extractPdfLines: vi.fn() }));

import { POST as PARSE } from "@/app/api/invoices/parse/route";
import { POST as CONFIRM } from "@/app/api/invoices/confirm/route";
import { extractPdfLines } from "@/lib/pdf";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { formDataRequest, jsonRequest, readJson } from "../helpers/http";

const lerPdf = vi.mocked(extractPdfLines);

beforeEach(() => {
  resetPrismaMock();
  lerPdf.mockReset();
});

/** Fatura mínima do Santander, no formato que `extractPdfLines` devolve. */
const faturaSantander = [
  "BANCO SANTANDER (BRASIL) S.A.",
  "Vencimento",
  "15/08/2026",
  "Total desta Fatura R$",
  "2.829,29",
  "Pagamento Mínimo R$",
  "282,92",
  "DAVID MATTAR - 1234 XXXX XXXX 8258",
  "Despesas",
  "05/08 SUPERMERCADO BH 150,00",
  "06/08 UBER TRIP 30,00",
];

function arquivoFatura(fileName = "Fatura_082026.pdf", extras: Record<string, string> = {}) {
  return formDataRequest("/api/invoices/parse", {
    file: { fileName, content: "conteudo-pdf" },
    ...extras,
  });
}

describe("POST /api/invoices/parse", () => {
  it("interpreta a fatura e devolve os lançamentos sem gravar nada", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([]);

    const { status, body } = await readJson(await PARSE(arquivoFatura()));

    expect(status).toBe(200);
    expect(body.bank).toBe("Santander");
    expect(body.referenceMonth).toBe("2026-08");
    expect(body.totalAmount).toBe(2829.29);
    expect(body.minPayment).toBe(282.92);
    expect(body.transactions).toHaveLength(2);
    expect(body.fileName).toBe("Fatura_082026.pdf");
    expect(prisma.transaction.createMany).not.toHaveBeenCalled();
  });

  it("sugere categoria para cada lançamento", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([
      { id: "cat-transporte", name: "Transporte", color: "#3b82f6", keywords: ["UBER"] },
    ]);

    const { body } = await readJson(await PARSE(arquivoFatura()));

    const uber = body.transactions.find((t: { description: string }) => t.description === "UBER TRIP");
    expect(uber.suggestedCategory).toEqual({
      id: "cat-transporte",
      name: "Transporte",
      color: "#3b82f6",
    });
    const mercado = body.transactions.find(
      (t: { description: string }) => t.description === "SUPERMERCADO BH",
    );
    expect(mercado.suggestedCategory).toBeNull();
  });

  it("lista os cartões distintos encontrados na fatura", async () => {
    lerPdf.mockResolvedValue([
      ...faturaSantander,
      "MARIA SOUZA - 1234 XXXX XXXX 4321",
      "Despesas",
      "07/08 FARMACIA 20,00",
    ]);
    prisma.category.findMany.mockResolvedValue([]);

    const { body } = await readJson(await PARSE(arquivoFatura()));

    expect(body.cards).toEqual([
      { holderName: "DAVID MATTAR", lastDigits: "8258" },
      { holderName: "MARIA SOUZA", lastDigits: "4321" },
    ]);
  });

  it("deriva o mês de referência do nome do arquivo", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([]);

    const { body } = await readJson(await PARSE(arquivoFatura("Fatura_012025_cartao.pdf")));

    expect(body.referenceMonth).toBe("2025-01");
  });

  it("respeita o mês de referência informado no formulário", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([]);

    const { body } = await readJson(
      await PARSE(arquivoFatura("Fatura_082026.pdf", { referenceMonth: "2026-07" })),
    );

    expect(body.referenceMonth).toBe("2026-07");
  });

  it("repassa a senha do PDF para a extração", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([]);

    await PARSE(arquivoFatura("Fatura_082026.pdf", { password: "12345678900" }));

    expect(lerPdf.mock.calls[0][1]).toBe("12345678900");
  });

  it("chama a extração sem senha quando ela não é informada", async () => {
    lerPdf.mockResolvedValue(faturaSantander);
    prisma.category.findMany.mockResolvedValue([]);

    await PARSE(arquivoFatura());

    expect(lerPdf.mock.calls[0][1]).toBeUndefined();
  });

  it("recusa 400 quando nenhum arquivo é enviado", async () => {
    const { status, body } = await readJson(
      await PARSE(formDataRequest("/api/invoices/parse", { password: "x" })),
    );
    expect(status).toBe(400);
    expect(body.error).toBe("Nenhum arquivo enviado.");
    expect(lerPdf).not.toHaveBeenCalled();
  });

  it("traduz erro de senha do PDF para uma mensagem clara", async () => {
    lerPdf.mockRejectedValue(new Error("No password given"));

    const { status, body } = await readJson(await PARSE(arquivoFatura()));

    expect(status).toBe(400);
    expect(body.error).toBe("Senha do PDF incorreta ou ausente.");
  });

  it("repassa outros erros de leitura do PDF", async () => {
    lerPdf.mockRejectedValue(new Error("Invalid PDF structure"));

    const { status, body } = await readJson(await PARSE(arquivoFatura()));

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid PDF structure");
  });

  it("usa mensagem genérica quando o erro não é um Error", async () => {
    lerPdf.mockRejectedValue("falha estranha");

    const { body } = await readJson(await PARSE(arquivoFatura()));

    expect(body.error).toBe("Erro ao ler o PDF.");
  });

  it("responde 422 quando o banco não é suportado", async () => {
    lerPdf.mockResolvedValue(["BANCO DESCONHECIDO", "Fatura"]);

    const { status, body } = await readJson(await PARSE(arquivoFatura()));

    expect(status).toBe(422);
    expect(body.error).toContain("Bancos suportados: Santander");
  });

  it("responde 422 quando a fatura é reconhecida mas sem lançamentos", async () => {
    lerPdf.mockResolvedValue(["BANCO SANTANDER (BRASIL) S.A.", "Detalhamento da Fatura"]);

    const { status, body } = await readJson(await PARSE(arquivoFatura()));

    expect(status).toBe(422);
    expect(body.error).toContain("Nenhum lançamento");
  });
});

describe("POST /api/invoices/confirm", () => {
  const corpoValido = {
    bank: "Santander",
    referenceMonth: "2026-08",
    dueDate: "2026-08-15T03:00:00.000Z",
    totalAmount: 2829.29,
    minPayment: 282.92,
    fileName: "Fatura_082026.pdf",
    primaryCard: { holderName: "DAVID MATTAR", lastDigits: "8258" },
    transactions: [
      {
        date: "2026-08-05T03:00:00.000Z",
        description: "SUPERMERCADO BH",
        amount: 150,
        type: "EXPENSE",
        section: "DESPESA",
        cardHolder: "DAVID MATTAR",
        cardLastDigits: "8258",
        categoryId: "cat-super",
      },
    ],
  };

  beforeEach(() => {
    prisma.creditCard.upsert.mockResolvedValue({ id: "card-1" });
    prisma.invoice.upsert.mockResolvedValue({ id: "inv-1" });
    prisma.transaction.createMany.mockResolvedValue({ count: 1 });
    prisma.transaction.findMany.mockResolvedValue([]);
  });

  it("grava a fatura e os lançamentos", async () => {
    const { status, body } = await readJson(
      await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido)),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ invoiceId: "inv-1", transactionsImported: 1 });
  });

  it("cria o cartão via upsert (não duplica em reimportação)", async () => {
    await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido));

    expect(prisma.creditCard.upsert).toHaveBeenCalledWith({
      where: {
        bank_holderName_lastDigits: {
          bank: "Santander",
          holderName: "DAVID MATTAR",
          lastDigits: "8258",
        },
      },
      update: {},
      create: { bank: "Santander", holderName: "DAVID MATTAR", lastDigits: "8258" },
    });
  });

  it("cria um cartão por titular distinto da fatura", async () => {
    prisma.creditCard.upsert
      .mockResolvedValueOnce({ id: "card-principal" })
      .mockResolvedValueOnce({ id: "card-adicional" });

    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [
          ...corpoValido.transactions,
          {
            ...corpoValido.transactions[0],
            description: "FARMACIA",
            cardHolder: "MARIA SOUZA",
            cardLastDigits: "4321",
            categoryId: null,
          },
        ],
      }),
    );

    expect(prisma.creditCard.upsert).toHaveBeenCalledTimes(2);
    const lancamentos = prisma.transaction.createMany.mock.calls[0][0].data;
    expect(lancamentos[0].creditCardId).toBe("card-principal");
    expect(lancamentos[1].creditCardId).toBe("card-adicional");
  });

  it("cria a fatura via upsert pelo cartão principal + mês", async () => {
    await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido));

    const args = prisma.invoice.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      creditCardId_referenceMonth: { creditCardId: "card-1", referenceMonth: "2026-08" },
    });
    expect(args.create).toMatchObject({
      referenceMonth: "2026-08",
      totalAmount: 2829.29,
      minPayment: 282.92,
      fileName: "Fatura_082026.pdf",
    });
    expect(args.update.dueDate).toBeInstanceOf(Date);
  });

  it("aceita fatura sem vencimento e sem pagamento mínimo", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        dueDate: null,
        minPayment: null,
      }),
    );

    const args = prisma.invoice.upsert.mock.calls[0][0];
    expect(args.create.dueDate).toBeNull();
    expect(args.create.minPayment).toBeNull();
  });

  it("apaga os lançamentos antigos antes de recriar (reimportação idempotente)", async () => {
    await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido));

    expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1" },
    });
    expect(prisma.transaction.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.transaction.createMany.mock.invocationCallOrder[0],
    );
  });

  it("marca os lançamentos como importados e preserva os detalhes", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [
          {
            ...corpoValido.transactions[0],
            amountUsd: 20.5,
            installmentCurrent: 2,
            installmentTotal: 10,
            section: "PARCELAMENTO",
            type: "EXPENSE",
          },
        ],
      }),
    );

    expect(prisma.transaction.createMany.mock.calls[0][0].data[0]).toMatchObject({
      description: "SUPERMERCADO BH",
      amount: 150,
      amountUsd: 20.5,
      installmentCurrent: 2,
      installmentTotal: 10,
      section: "PARCELAMENTO",
      invoiceId: "inv-1",
      source: "IMPORT",
    });
  });

  it("grava pendingReturn marcado na tela de revisão", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [
          { ...corpoValido.transactions[0], pendingReturn: true },
          { ...corpoValido.transactions[0], description: "PADARIA", pendingReturn: false },
        ],
      }),
    );

    const criados = prisma.transaction.createMany.mock.calls[0][0].data;
    expect(criados[0].pendingReturn).toBe(true);
    expect(criados[1].pendingReturn).toBe(false);
  });

  it("pendingReturn é false quando o lançamento não traz o campo", async () => {
    await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido));

    expect(prisma.transaction.createMany.mock.calls[0][0].data[0].pendingReturn).toBe(false);
  });

  it("recusa pendingReturn que não é booleano com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(
        jsonRequest("POST", "/api/invoices/confirm", {
          ...corpoValido,
          transactions: [{ ...corpoValido.transactions[0], pendingReturn: "sim" }],
        }),
      ),
    );

    expect(status).toBe(400);
  });

  it("grava a descrição reescrita na tela de revisão", async () => {
    // O parser extrai o nome do adquirente; a tela permite renomear antes de
    // gravar, e é o texto renomeado que tem que chegar aqui.
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [{ ...corpoValido.transactions[0], description: "Feira da semana" }],
      }),
    );

    expect(prisma.transaction.createMany.mock.calls[0][0].data[0].description).toBe(
      "Feira da semana",
    );
  });

  it("recusa lançamento com descrição vazia com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(
        jsonRequest("POST", "/api/invoices/confirm", {
          ...corpoValido,
          transactions: [{ ...corpoValido.transactions[0], description: "" }],
        }),
      ),
    );

    expect(status).toBe(400);
  });

  it("usa null nos campos opcionais ausentes do lançamento", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [{ ...corpoValido.transactions[0], categoryId: null }],
      }),
    );

    expect(prisma.transaction.createMany.mock.calls[0][0].data[0]).toMatchObject({
      amountUsd: null,
      installmentCurrent: null,
      installmentTotal: null,
      categoryId: null,
    });
  });

  it("aplica sub-itens fixos nas transações que ficaram com categoria", async () => {
    prisma.transaction.findMany.mockResolvedValue([{ id: "tx-1", categoryId: "cat-super" }]);
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: ["Comida"] });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", corpoValido));

    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { invoiceId: "inv-1", categoryId: { in: ["cat-super"] } },
      select: { id: true, categoryId: true },
    });
    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [{ transactionId: "tx-1", description: "Comida", amount: 0 }],
    });
  });

  it("não procura sub-itens fixos quando nenhum lançamento tem categoria", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/invoices/confirm", {
        ...corpoValido,
        transactions: [{ ...corpoValido.transactions[0], categoryId: null }],
      }),
    );

    expect(prisma.transaction.findMany).not.toHaveBeenCalled();
  });

  it("aceita valor negativo em lançamento de crédito", async () => {
    const { status } = await readJson(
      await CONFIRM(
        jsonRequest("POST", "/api/invoices/confirm", {
          ...corpoValido,
          transactions: [
            {
              ...corpoValido.transactions[0],
              amount: -50,
              type: "PAYMENT",
              section: "CREDITO",
            },
          ],
        }),
      ),
    );
    expect(status).toBe(200);
  });

  it("recusa mês de referência fora do formato YYYY-MM com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(
        jsonRequest("POST", "/api/invoices/confirm", { ...corpoValido, referenceMonth: "08/2026" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.invoice.upsert).not.toHaveBeenCalled();
  });

  it("recusa fatura sem nenhum lançamento com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(jsonRequest("POST", "/api/invoices/confirm", { ...corpoValido, transactions: [] })),
    );
    expect(status).toBe(400);
  });

  it("recusa seção ou tipo inválidos com 400", async () => {
    for (const over of [{ section: "OUTRA" }, { type: "TRANSFERENCIA" }]) {
      const { status } = await readJson(
        await CONFIRM(
          jsonRequest("POST", "/api/invoices/confirm", {
            ...corpoValido,
            transactions: [{ ...corpoValido.transactions[0], ...over }],
          }),
        ),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa cartão sem titular ou sem dígitos com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(
        jsonRequest("POST", "/api/invoices/confirm", {
          ...corpoValido,
          primaryCard: { holderName: "", lastDigits: "8258" },
        }),
      ),
    );
    expect(status).toBe(400);
  });
});
