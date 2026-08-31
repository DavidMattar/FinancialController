import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/investments/route";
import { DELETE, PATCH } from "@/app/api/investments/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

/** Corpo de uma compra nova, como a tela envia. */
const novaCompra = {
  type: "CRYPTO",
  symbol: "BTC",
  name: "Bitcoin",
  quantity: 0.5,
  unitCostBrl: 200000,
};

describe("GET /api/investments", () => {
  it("lista as posições na ordem de criação, com as compras de cada uma", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([{ id: "hold-1", purchases: [] }]);

    const { status } = await readJson(await GET());

    expect(status).toBe(200);
    expect(prisma.investmentHolding.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
      include: { purchases: { orderBy: { createdAt: "asc" } } },
    });
  });

  it("devolve quantidade e custo médio somados das compras", async () => {
    // Os dois NÃO são colunas do banco: saem da soma das compras
    // (src/lib/investments.ts). 3 a R$100 + 1 a R$200 = 4 a custo médio R$125.
    prisma.investmentHolding.findMany.mockResolvedValue([
      {
        id: "hold-1",
        symbol: "BTC",
        purchases: [
          { id: "buy-1", quantity: "3", unitCostBrl: "100", createdAt: new Date() },
          { id: "buy-2", quantity: "1", unitCostBrl: "200", createdAt: new Date() },
        ],
      },
    ]);

    const { body } = await readJson(await GET());

    expect(body[0]).toMatchObject({ quantity: 4, cost: 500, avgCostBrl: 125 });
  });

  it("não busca cotação aqui (isso é da rota de preços)", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([{ id: "hold-1", purchases: [] }]);

    const { body } = await readJson(await GET());

    expect(body[0]).not.toHaveProperty("priceBrl");
  });
});

describe("POST /api/investments — ativo novo", () => {
  beforeEach(() => prisma.investmentHolding.findUnique.mockResolvedValue(null));

  it("cria a posição com a primeira compra junto e responde 201", async () => {
    prisma.investmentHolding.create.mockResolvedValue({ id: "hold-novo" });

    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", novaCompra)),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "hold-novo" });
    // Identidade e primeira compra nascem juntas: não existe posição sem compra.
    expect(prisma.investmentHolding.create).toHaveBeenCalledWith({
      data: {
        type: "CRYPTO",
        symbol: "BTC",
        name: "Bitcoin",
        notes: undefined,
        purchases: { create: { quantity: 0.5, unitCostBrl: 200000 } },
      },
      include: { purchases: true },
    });
  });

  it("aceita posição em moeda estrangeira", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});

    const { status } = await readJson(
      await POST(
        jsonRequest("POST", "/api/investments", {
          type: "CURRENCY",
          symbol: "USD",
          name: "Dólar",
          quantity: 100,
          unitCostBrl: 5,
        }),
      ),
    );

    expect(status).toBe(201);
  });

  it("aceita preço zero (ativo recebido, não comprado)", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, unitCostBrl: 0 })),
    );
    expect(status).toBe(201);
  });

  it("aceita descrição do ativo", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});
    await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, notes: "carteira fria" }));
    expect(prisma.investmentHolding.create.mock.calls[0][0].data.notes).toBe("carteira fria");
  });

  it("recusa tipo de investimento inválido com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, type: "ACAO" })),
    );
    expect(status).toBe(400);
    expect(prisma.investmentHolding.create).not.toHaveBeenCalled();
  });

  it("recusa quantidade zero ou negativa com 400", async () => {
    for (const quantity of [0, -1]) {
      const { status } = await readJson(
        await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, quantity })),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa preço negativo com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, unitCostBrl: -1 })),
    );
    expect(status).toBe(400);
  });

  it("recusa símbolo ou nome vazio com 400", async () => {
    expect(
      (await readJson(await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, symbol: "" }))))
        .status,
    ).toBe(400);
    expect(
      (await readJson(await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, name: "" }))))
        .status,
    ).toBe(400);
  });

  it("aceita valor com vírgula ou ponto decimal (formato BR e internacional)", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/investments", {
        ...novaCompra,
        quantity: "0,5",
        unitCostBrl: "350.000,00",
      }),
    );

    expect(prisma.investmentHolding.create.mock.calls[0][0].data.purchases.create).toEqual({
      quantity: 0.5,
      unitCostBrl: 350000,
    });
  });

  it("recusa com 400 um valor que não descreve número", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaCompra, unitCostBrl: "abc" })),
    );
    expect(status).toBe(400);
    expect(prisma.investmentHolding.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/investments — segunda compra do mesmo ativo", () => {
  // Só existe UMA posição por tipo+símbolo (@@unique no schema). Cadastrar de
  // novo o mesmo ativo não é erro: é uma compra nova daquela posição. Antes
  // disso o segundo cadastro estourava a constraint, virava 500, e a tela não
  // mostrava nada.
  const existente = {
    id: "hold-1",
    type: "CRYPTO",
    symbol: "BTC",
    name: "Bitcoin",
    notes: "carteira fria",
  };

  it("anexa a compra à posição existente, sem sobrescrever nada", async () => {
    prisma.investmentHolding.findUnique.mockResolvedValue(existente);
    prisma.investmentPurchase.create.mockResolvedValue({ id: "buy-2" });

    const { status, body } = await readJson(
      await POST(
        jsonRequest("POST", "/api/investments", { ...novaCompra, quantity: 0.25, unitCostBrl: 300000 }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.investmentPurchase.create).toHaveBeenCalledWith({
      data: { holdingId: "hold-1", quantity: 0.25, unitCostBrl: 300000 },
    });
    expect(prisma.investmentHolding.create).not.toHaveBeenCalled();
    // A tela usa esse sinal para avisar que a compra entrou numa posição que
    // já existia, em vez de parecer que não fez nada por não ter surgido linha.
    expect(body.merged).toBe(true);
  });

  it("não recalcula nem grava custo médio (ele é derivado das compras)", async () => {
    prisma.investmentHolding.findUnique.mockResolvedValue(existente);
    prisma.investmentPurchase.create.mockResolvedValue({});

    await POST(jsonRequest("POST", "/api/investments", novaCompra));

    expect(prisma.investmentHolding.update).not.toHaveBeenCalled();
  });

  it("preserva nome e descrição da posição existente", async () => {
    // A segunda compra fala de quantidade e preço, não da identidade do ativo.
    prisma.investmentHolding.findUnique.mockResolvedValue(existente);
    prisma.investmentPurchase.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/investments", {
        ...novaCompra,
        name: "BTC",
        notes: "outra anotação",
      }),
    );

    expect(prisma.investmentHolding.update).not.toHaveBeenCalled();
    expect(prisma.investmentPurchase.create.mock.calls[0][0].data).not.toHaveProperty("notes");
  });

  it("procura a posição existente pelo par tipo+símbolo", async () => {
    prisma.investmentHolding.findUnique.mockResolvedValue(null);
    prisma.investmentHolding.create.mockResolvedValue({});

    await POST(jsonRequest("POST", "/api/investments", novaCompra));

    expect(prisma.investmentHolding.findUnique).toHaveBeenCalledWith({
      where: { type_symbol: { type: "CRYPTO", symbol: "BTC" } },
    });
  });

  it("não confunde ativos de tipos diferentes com o mesmo símbolo", async () => {
    // Um USD em moeda estrangeira e um "USD" em cripto são posições distintas —
    // é o par tipo+símbolo que identifica, não o símbolo sozinho.
    prisma.investmentHolding.findUnique.mockResolvedValue(null);
    prisma.investmentHolding.create.mockResolvedValue({});

    await POST(
      jsonRequest("POST", "/api/investments", { ...novaCompra, type: "CURRENCY", symbol: "USD" }),
    );

    expect(prisma.investmentHolding.findUnique).toHaveBeenCalledWith({
      where: { type_symbol: { type: "CURRENCY", symbol: "USD" } },
    });
    expect(prisma.investmentHolding.create).toHaveBeenCalled();
  });
});

describe("PATCH /api/investments/[id]", () => {
  it("atualiza a descrição do ativo (é o que a coluna Descrição usa)", async () => {
    prisma.investmentHolding.update.mockResolvedValue({ id: "hold-1" });

    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/investments/hold-1", { notes: "reserva de longo prazo" }),
        routeParams({ id: "hold-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.investmentHolding.update).toHaveBeenCalledWith({
      where: { id: "hold-1" },
      data: { notes: "reserva de longo prazo" },
    });
  });

  it("atualiza símbolo e nome", async () => {
    prisma.investmentHolding.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/investments/hold-1", { symbol: "ETH", name: "Ethereum" }),
      routeParams({ id: "hold-1" }),
    );
    expect(prisma.investmentHolding.update.mock.calls[0][0].data).toEqual({
      symbol: "ETH",
      name: "Ethereum",
    });
  });

  it("aceita corpo vazio", async () => {
    prisma.investmentHolding.update.mockResolvedValue({});
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/investments/hold-1", {}),
        routeParams({ id: "hold-1" }),
      ),
    );
    expect(status).toBe(200);
  });

  it("aceita limpar a descrição com null", async () => {
    prisma.investmentHolding.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/investments/hold-1", { notes: null }),
      routeParams({ id: "hold-1" }),
    );
    expect(prisma.investmentHolding.update.mock.calls[0][0].data).toEqual({ notes: null });
  });

  it("recusa nome vazio com 400", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/investments/hold-1", { name: "" }),
        routeParams({ id: "hold-1" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.investmentHolding.update).not.toHaveBeenCalled();
  });

  it("ignora quantidade e custo médio: não são mais campos da posição", async () => {
    // Mudar a posição agora é registrar uma compra (POST) ou apagar uma compra
    // errada — não editar um total.
    prisma.investmentHolding.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/investments/hold-1", {
        quantity: 99,
        avgCostBrl: 1,
        name: "Outro",
      }),
      routeParams({ id: "hold-1" }),
    );
    expect(prisma.investmentHolding.update.mock.calls[0][0].data).toEqual({ name: "Outro" });
  });

  it("não permite trocar o tipo do investimento (campo fora do schema é ignorado)", async () => {
    prisma.investmentHolding.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/investments/hold-1", { type: "CURRENCY", name: "Outro" }),
      routeParams({ id: "hold-1" }),
    );
    expect(prisma.investmentHolding.update.mock.calls[0][0].data).toEqual({ name: "Outro" });
  });
});

describe("DELETE /api/investments/[id]", () => {
  it("remove a posição", async () => {
    const { status, body } = await readJson(
      await DELETE(deleteRequest("/api/investments/hold-1"), routeParams({ id: "hold-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.investmentHolding.delete).toHaveBeenCalledWith({ where: { id: "hold-1" } });
  });

  it("não toca no ledger de transações", async () => {
    await DELETE(deleteRequest("/api/investments/hold-1"), routeParams({ id: "hold-1" }));
    expect(prisma.transaction.deleteMany).not.toHaveBeenCalled();
  });
});
