import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logFiles", () => ({ appendLogEvents: vi.fn() }));

import { POST } from "@/app/api/logs/route";
import { appendLogEvents } from "@/lib/logFiles";
import { jsonRequest, rawRequest, readJson } from "../helpers/http";

const gravar = vi.mocked(appendLogEvents);

beforeEach(() => {
  gravar.mockReset();
  gravar.mockResolvedValue({ "2026-08-31/transacoes.log": 1 });
});

/** Um evento válido, como o navegador manda. */
function evento(over: Record<string, unknown> = {}) {
  return {
    at: "2026-08-31T18:05:02.000Z",
    tab: "transacoes",
    level: "info",
    action: "gravou",
    detail: "criou transação",
    ...over,
  };
}

function post(body: unknown) {
  return POST(jsonRequest("POST", "/api/logs", body));
}

describe("POST /api/logs", () => {
  it("grava os eventos e responde o que escreveu", async () => {
    const { status, body } = await readJson(await post({ events: [evento()] }));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, written: { "2026-08-31/transacoes.log": 1 } });
    expect(gravar).toHaveBeenCalledWith([evento()]);
  });

  it("aceita lote de eventos de abas diferentes", async () => {
    await post({ events: [evento(), evento({ tab: "investimentos", level: "error", action: "erro" })] });

    expect(gravar.mock.calls[0][0]).toHaveLength(2);
  });

  it("respeita o instante enviado pelo cliente, sem substituir por 'agora'", async () => {
    // O que interessa é a hora da movimentação, não a do POST — o envio pode
    // chegar depois.
    await post({ events: [evento({ at: "2020-01-02T03:04:05.000Z" })] });

    expect(gravar.mock.calls[0][0][0].at).toBe("2020-01-02T03:04:05.000Z");
  });

  it("aceita detalhe técnico opcional", async () => {
    await post({ events: [evento({ level: "error", technical: "POST /x · HTTP 500" })] });

    expect(gravar.mock.calls[0][0][0].technical).toBe("POST /x · HTTP 500");
  });

  it("recusa corpo que não é JSON, com 400 e sem gravar", async () => {
    const { status } = await readJson(await POST(rawRequest("POST", "/api/logs", "{quebrado")));

    expect(status).toBe(400);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("recusa lote vazio", async () => {
    expect((await readJson(await post({ events: [] }))).status).toBe(400);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("recusa corpo sem a lista de eventos", async () => {
    expect((await readJson(await post({}))).status).toBe(400);
  });

  it("recusa nível fora de info/error", async () => {
    expect((await readJson(await post({ events: [evento({ level: "debug" })] }))).status).toBe(400);
  });

  it("recusa data/hora inválida", async () => {
    expect((await readJson(await post({ events: [evento({ at: "ontem" })] }))).status).toBe(400);
  });

  it("recusa campo obrigatório vazio", async () => {
    for (const campo of ["tab", "action", "detail"]) {
      const { status } = await readJson(await post({ events: [evento({ [campo]: "" })] }));
      expect(status, campo).toBe(400);
    }
  });

  it("limita o tamanho do lote, para um cliente com defeito não encher o disco", async () => {
    const muitos = Array.from({ length: 201 }, () => evento());

    expect((await readJson(await post({ events: muitos }))).status).toBe(400);
    expect(gravar).not.toHaveBeenCalled();
  });

  it("aceita o lote no limite", async () => {
    const noLimite = Array.from({ length: 200 }, () => evento());

    expect((await readJson(await post({ events: noLimite }))).status).toBe(200);
  });

  it("limita o tamanho de cada campo de texto", async () => {
    expect(
      (await readJson(await post({ events: [evento({ detail: "x".repeat(501) })] }))).status,
    ).toBe(400);
    expect(
      (await readJson(await post({ events: [evento({ technical: "x".repeat(4001) })] }))).status,
    ).toBe(400);
  });

  it("falha de disco responde 500 com a causa, em vez de fingir que gravou", async () => {
    gravar.mockRejectedValue(new Error("EACCES: permission denied"));

    const { status, body } = await readJson(await post({ events: [evento()] }));

    expect(status).toBe(500);
    expect(body.error).toContain("EACCES");
  });

  it("falha que não é Error também responde 500", async () => {
    gravar.mockRejectedValue("disco cheio");

    const { status, body } = await readJson(await post({ events: [evento()] }));

    expect(status).toBe(500);
    expect(body.error).toContain("disco cheio");
  });
});
