import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));

import { GET as getViews, POST as postView } from "@/app/api/views/route";
import { DELETE as deleteView } from "@/app/api/views/[id]/route";
import { GET as getCards } from "@/app/api/credit-cards/route";
import { prisma, resetPrismaMock } from "../helpers/prismaMock";
import { deleteRequest, jsonRequest, readJson, routeParams } from "../helpers/http";

beforeEach(resetPrismaMock);

describe("GET /api/views", () => {
  it("lista as views salvas na ordem de criação", async () => {
    prisma.dashboardView.findMany.mockResolvedValue([{ id: "view-1", name: "Este mês" }]);

    const { status, body } = await readJson(await getViews());

    expect(status).toBe(200);
    expect(body).toEqual([{ id: "view-1", name: "Este mês" }]);
    expect(prisma.dashboardView.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("POST /api/views", () => {
  it("salva a view com os filtros e responde 201", async () => {
    prisma.dashboardView.create.mockResolvedValue({ id: "view-nova" });

    const { status, body } = await readJson(
      await postView(
        jsonRequest("POST", "/api/views", {
          name: "Últimos 3 meses",
          filters: { from: "2026-06-01", to: "2026-08-31" },
        }),
      ),
    );

    expect(status).toBe(201);
    expect(body).toEqual({ id: "view-nova" });
    expect(prisma.dashboardView.create).toHaveBeenCalledWith({
      data: {
        name: "Últimos 3 meses",
        filters: { from: "2026-06-01", to: "2026-08-31" },
        isDefault: false,
      },
    });
  });

  it("aceita um objeto de filtros livre (qualquer forma)", async () => {
    prisma.dashboardView.create.mockResolvedValue({});

    const filtros = {
      categoryIds: ["a", "b"],
      apenasDespesas: true,
      aninhado: { nivel: 2 },
      nulo: null,
    };
    const { status } = await readJson(
      await postView(jsonRequest("POST", "/api/views", { name: "Livre", filters: filtros })),
    );

    expect(status).toBe(201);
    expect(prisma.dashboardView.create.mock.calls[0][0].data.filters).toEqual(filtros);
  });

  it("aceita filtros vazios", async () => {
    prisma.dashboardView.create.mockResolvedValue({});
    const { status } = await readJson(
      await postView(jsonRequest("POST", "/api/views", { name: "Vazia", filters: {} })),
    );
    expect(status).toBe(201);
  });

  it("desmarca as outras views antes de salvar uma nova como padrão", async () => {
    prisma.dashboardView.create.mockResolvedValue({});

    await postView(
      jsonRequest("POST", "/api/views", { name: "Padrão", filters: {}, isDefault: true }),
    );

    expect(prisma.dashboardView.updateMany).toHaveBeenCalledWith({
      data: { isDefault: false },
    });
    // A limpeza acontece ANTES da criação, senão a nova seria desmarcada também.
    expect(prisma.dashboardView.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.dashboardView.create.mock.invocationCallOrder[0],
    );
  });

  it("não desmarca ninguém quando a view não é padrão", async () => {
    prisma.dashboardView.create.mockResolvedValue({});

    await postView(jsonRequest("POST", "/api/views", { name: "Comum", filters: {} }));

    expect(prisma.dashboardView.updateMany).not.toHaveBeenCalled();
  });

  it("recusa nome vazio com 400", async () => {
    const { status } = await readJson(
      await postView(jsonRequest("POST", "/api/views", { name: "", filters: {} })),
    );
    expect(status).toBe(400);
    expect(prisma.dashboardView.create).not.toHaveBeenCalled();
  });

  it("recusa corpo sem filtros com 400", async () => {
    const { status } = await readJson(
      await postView(jsonRequest("POST", "/api/views", { name: "Sem filtros" })),
    );
    expect(status).toBe(400);
  });

  it("recusa filtros que não são objeto com 400", async () => {
    const { status } = await readJson(
      await postView(jsonRequest("POST", "/api/views", { name: "X", filters: "texto" })),
    );
    expect(status).toBe(400);
  });
});

describe("DELETE /api/views/[id]", () => {
  it("remove a view salva", async () => {
    const { status, body } = await readJson(
      await deleteView(deleteRequest("/api/views/view-1"), routeParams({ id: "view-1" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(prisma.dashboardView.delete).toHaveBeenCalledWith({ where: { id: "view-1" } });
  });

  it("não promove nenhuma outra view a padrão", async () => {
    await deleteView(deleteRequest("/api/views/view-1"), routeParams({ id: "view-1" }));
    expect(prisma.dashboardView.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/credit-cards", () => {
  it("lista os cartões ordenados pelo titular", async () => {
    prisma.creditCard.findMany.mockResolvedValue([
      { id: "card-1", holderName: "DAVID", lastDigits: "8258" },
    ]);

    const { status, body } = await readJson(await getCards());

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(prisma.creditCard.findMany).toHaveBeenCalledWith({
      orderBy: { holderName: "asc" },
    });
  });

  it("devolve lista vazia quando nenhuma fatura foi importada ainda", async () => {
    prisma.creditCard.findMany.mockResolvedValue([]);
    const { body } = await readJson(await getCards());
    expect(body).toEqual([]);
  });
});
