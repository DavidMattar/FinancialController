import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET, POST } from "@/app/api/investments/route";
import { DELETE, PATCH } from "@/app/api/investments/[id]/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

const novaPosicao = {
  type: "CRYPTO",
  symbol: "BTC",
  name: "Bitcoin",
  quantity: 0.5,
  avgCostBrl: 200000,
};

describe("GET /api/investments", () => {
  it("lista as posições na ordem de criação", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([{ id: "hold-1" }]);

    const { status, body } = await readJson(await GET());

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "hold-1" }]);
    expect(prisma.investmentHolding.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
    });
  });

  it("não busca cotação aqui (isso é da rota de preços)", async () => {
    prisma.investmentHolding.findMany.mockResolvedValue([
      { id: "hold-1", symbol: "BTC", quantity: "0.5", avgCostBrl: "200000" },
    ]);

    const { body } = await readJson(await GET());

    expect(body[0]).not.toHaveProperty("currentPrice");
  });
});

describe("POST /api/investments", () => {
  it("cria a posição e responde 201", async () => {
    prisma.investmentHolding.create.mockResolvedValue({ id: "hold-novo" });

    const { status, body } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", novaPosicao)),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "hold-novo" });
    expect(prisma.investmentHolding.create).toHaveBeenCalledWith({ data: novaPosicao });
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
          avgCostBrl: 5,
        }),
      ),
    );

    expect(status).toBe(201);
  });

  it("aceita custo médio zero (ativo recebido, não comprado)", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, avgCostBrl: 0 })),
    );
    expect(status).toBe(201);
  });

  it("aceita observação", async () => {
    prisma.investmentHolding.create.mockResolvedValue({});
    await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, notes: "carteira fria" }));
    expect(prisma.investmentHolding.create.mock.calls[0][0].data.notes).toBe("carteira fria");
  });

  it("recusa tipo de investimento inválido com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, type: "ACAO" })),
    );
    expect(status).toBe(400);
    expect(prisma.investmentHolding.create).not.toHaveBeenCalled();
  });

  it("recusa quantidade zero ou negativa com 400", async () => {
    for (const quantity of [0, -1]) {
      const { status } = await readJson(
        await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, quantity })),
      );
      expect(status).toBe(400);
    }
  });

  it("recusa custo médio negativo com 400", async () => {
    const { status } = await readJson(
      await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, avgCostBrl: -1 })),
    );
    expect(status).toBe(400);
  });

  it("recusa símbolo ou nome vazio com 400", async () => {
    expect(
      (await readJson(await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, symbol: "" }))))
        .status,
    ).toBe(400);
    expect(
      (await readJson(await POST(jsonRequest("POST", "/api/investments", { ...novaPosicao, name: "" }))))
        .status,
    ).toBe(400);
  });
});

describe("PATCH /api/investments/[id]", () => {
  it("atualiza quantidade e custo médio (caso de nova compra do mesmo ativo)", async () => {
    prisma.investmentHolding.update.mockResolvedValue({ id: "hold-1" });

    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/investments/hold-1", { quantity: 0.75, avgCostBrl: 210000 }),
        routeParams({ id: "hold-1" }),
      ),
    );

    expect(status).toBe(200);
    expect(prisma.investmentHolding.update).toHaveBeenCalledWith({
      where: { id: "hold-1" },
      data: { quantity: 0.75, avgCostBrl: 210000 },
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

  it("aceita limpar a observação com null", async () => {
    prisma.investmentHolding.update.mockResolvedValue({});
    await PATCH(
      jsonRequest("PATCH", "/api/investments/hold-1", { notes: null }),
      routeParams({ id: "hold-1" }),
    );
    expect(prisma.investmentHolding.update.mock.calls[0][0].data).toEqual({ notes: null });
  });

  it("recusa quantidade negativa com 400", async () => {
    const { status } = await readJson(
      await PATCH(
        jsonRequest("PATCH", "/api/investments/hold-1", { quantity: -1 }),
        routeParams({ id: "hold-1" }),
      ),
    );
    expect(status).toBe(400);
    expect(prisma.investmentHolding.update).not.toHaveBeenCalled();
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
