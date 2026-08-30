import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));
vi.mock("@/lib/pdf", () => ({ extractPdfLines: vi.fn() }));

import { POST as PARSE } from "@/app/api/receipts/parse/route";
import { POST as CONFIRM } from "@/app/api/receipts/confirm/route";
import { extractPdfLines } from "@/lib/pdf";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { formDataRequest, jsonRequest, readJson } from "../helpers/http";

const lerPdf = vi.mocked(extractPdfLines);

beforeEach(() => {
  resetPrismaMock();
  lerPdf.mockReset();
});

const itemNfce =
  "ARROZ TIPO 1 5KG (Código: 123) Qtde total de ítens: 1.000 UN: UN Valor total R$: R$ 25,90";
const notaTexto = [
  "Nota Fiscal de Consumidor Eletrônica",
  "SUPERMERCADO BH LTDA",
  "CNPJ: 12.345.678/0001-90",
  itemNfce,
].join("\n");

describe("POST /api/receipts/parse — texto colado", () => {
  it("interpreta a nota e devolve os itens sem gravar nada", async () => {
    prisma.category.findFirst.mockResolvedValue({ id: "cat-super" });

    const { status, body } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", { text: notaTexto })),
    );

    expect(status).toBe(200);
    expect(body.storeName).toBe("SUPERMERCADO BH LTDA");
    expect(body.cnpj).toBe("12.345.678/0001-90");
    expect(body.items).toHaveLength(1);
    expect(body.computedTotal).toBe(25.9);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("sugere a categoria Supermercado", async () => {
    prisma.category.findFirst.mockResolvedValue({ id: "cat-super" });

    const { body } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", { text: notaTexto })),
    );

    expect(prisma.category.findFirst).toHaveBeenCalledWith({ where: { name: "Supermercado" } });
    expect(body.suggestedCategoryId).toBe("cat-super");
  });

  it("devolve sugestão nula quando a categoria Supermercado não existe", async () => {
    prisma.category.findFirst.mockResolvedValue(null);

    const { body } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", { text: notaTexto })),
    );

    expect(body.suggestedCategoryId).toBeNull();
  });

  it("devolve nulos para os campos que a nota não trazia", async () => {
    prisma.category.findFirst.mockResolvedValue(null);

    const { body } = await readJson(
      await PARSE(
        formDataRequest("/api/receipts/parse", {
          text: ["Nota Fiscal de Consumidor Eletrônica", itemNfce].join("\n"),
        }),
      ),
    );

    expect(body.cnpj).toBeNull();
    expect(body.date).toBeNull();
    expect(body.officialTotal).toBeNull();
  });

  it("recusa 400 quando não vem nem arquivo nem texto", async () => {
    const { status, body } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", {})),
    );
    expect(status).toBe(400);
    expect(body.error).toContain("Envie um arquivo PDF ou cole o texto");
  });

  it("recusa 400 quando o texto colado é só espaço", async () => {
    const { status } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", { text: "   \n  " })),
    );
    expect(status).toBe(400);
  });

  it("responde 422 quando o formato da nota não é reconhecido", async () => {
    const { status, body } = await readJson(
      await PARSE(formDataRequest("/api/receipts/parse", { text: "cupom de outro formato" })),
    );
    expect(status).toBe(422);
    expect(body.error).toContain("Formato ainda não suportado");
  });

  it("responde 422 quando a nota é reconhecida mas sem itens legíveis", async () => {
    const { status } = await readJson(
      await PARSE(
        formDataRequest("/api/receipts/parse", {
          text: "Nota Fiscal de Consumidor Eletrônica\nlayout diferente",
        }),
      ),
    );
    expect(status).toBe(422);
  });
});

describe("POST /api/receipts/parse — arquivo PDF", () => {
  it("extrai o texto do PDF e interpreta a nota", async () => {
    lerPdf.mockResolvedValue(notaTexto.split("\n"));
    prisma.category.findFirst.mockResolvedValue(null);

    const { status, body } = await readJson(
      await PARSE(
        formDataRequest("/api/receipts/parse", {
          file: { fileName: "nota.pdf", content: "conteudo-pdf" },
        }),
      ),
    );

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(lerPdf).toHaveBeenCalledTimes(1);
    expect(lerPdf.mock.calls[0][0]).toBeInstanceOf(Buffer);
  });

  it("dá preferência ao arquivo quando vêm arquivo e texto", async () => {
    lerPdf.mockResolvedValue(notaTexto.split("\n"));
    prisma.category.findFirst.mockResolvedValue(null);

    await PARSE(
      formDataRequest("/api/receipts/parse", {
        file: { fileName: "nota.pdf", content: "pdf" },
        text: "texto ignorado",
      }),
    );

    expect(lerPdf).toHaveBeenCalled();
  });

  it("responde 400 com a mensagem do erro de leitura do PDF", async () => {
    lerPdf.mockRejectedValue(new Error("PDF corrompido"));

    const { status, body } = await readJson(
      await PARSE(
        formDataRequest("/api/receipts/parse", {
          file: { fileName: "nota.pdf", content: "pdf" },
        }),
      ),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("PDF corrompido");
  });

  it("responde 400 com mensagem genérica quando o erro não é um Error", async () => {
    lerPdf.mockRejectedValue("falha estranha");

    const { status, body } = await readJson(
      await PARSE(
        formDataRequest("/api/receipts/parse", {
          file: { fileName: "nota.pdf", content: "pdf" },
        }),
      ),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Erro ao ler o PDF.");
  });
});

describe("POST /api/receipts/confirm", () => {
  const corpoValido = {
    date: "2026-08-15",
    storeName: "SUPERMERCADO BH",
    categoryId: "cat-super",
    items: [
      { description: "Arroz", amount: 25.9 },
      { description: "Banana", amount: 3.98 },
    ],
  };

  beforeEach(() => {
    prisma.transaction.create.mockResolvedValue({ id: "tx-nova" });
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: [] });
  });

  it("cria UMA transação com a soma dos itens", async () => {
    const { status, body } = await readJson(
      await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", corpoValido)),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      transactionId: "tx-nova",
      itemsImported: 2,
      totalAmount: 29.88,
    });
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.create.mock.calls[0][0].data).toMatchObject({
      description: "SUPERMERCADO BH",
      amount: 29.88,
      type: "EXPENSE",
      source: "IMPORT",
      categoryId: "cat-super",
    });
  });

  it("converte a data sem cair no bug de fuso", async () => {
    await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", corpoValido));
    expect(prisma.transaction.create.mock.calls[0][0].data.date).toEqual(new Date(2026, 7, 15));
  });

  it("cria um sub-item por produto da nota", async () => {
    await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", corpoValido));

    expect(prisma.transactionItem.createMany).toHaveBeenCalledWith({
      data: [
        { transactionId: "tx-nova", description: "Arroz", amount: 25.9 },
        { transactionId: "tx-nova", description: "Banana", amount: 3.98 },
      ],
    });
  });

  it("aceita compra sem categoria", async () => {
    await CONFIRM(
      jsonRequest("POST", "/api/receipts/confirm", { ...corpoValido, categoryId: null }),
    );

    expect(prisma.transaction.create.mock.calls[0][0].data.categoryId).toBeNull();
    // Sem categoria não há sub-item fixo para garantir.
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
  });

  it("aplica os sub-itens fixos da categoria escolhida", async () => {
    prisma.category.findUnique.mockResolvedValue({ fixedSubItems: ["Comida"] });
    prisma.transactionItem.findMany.mockResolvedValue([]);

    await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", corpoValido));

    // Um createMany para os itens da nota e outro para os sub-itens fixos.
    expect(prisma.transactionItem.createMany).toHaveBeenCalledTimes(2);
  });

  it("recusa nota sem item com 400", async () => {
    const { status } = await readJson(
      await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", { ...corpoValido, items: [] })),
    );
    expect(status).toBe(400);
    expect(prisma.transaction.create).not.toHaveBeenCalled();
  });

  it("recusa item com valor zero ou descrição vazia com 400", async () => {
    for (const items of [
      [{ description: "Arroz", amount: 0 }],
      [{ description: "", amount: 10 }],
    ]) {
      const { status } = await readJson(
        await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", { ...corpoValido, items })),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa corpo sem data ou sem loja com 400", async () => {
    for (const corpo of [
      { storeName: "X", items: corpoValido.items },
      { date: "2026-08-15", storeName: "", items: corpoValido.items },
    ]) {
      const { status } = await readJson(
        await CONFIRM(jsonRequest("POST", "/api/receipts/confirm", corpo)),
      );
      expect(status).toBe(400);
    }
  });
});
