import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => import("../helpers/prismaMock"));
vi.mock("@/lib/backup", async () => {
  const real = await import("@/lib/backup");
  return { ...real, collectBackup: vi.fn(), restoreBackup: vi.fn() };
});

import { GET as EXPORT } from "@/app/api/backup/export/route";
import { POST as RESTORE } from "@/app/api/backup/restore/route";
import { BACKUP_FORMAT_VERSION, collectBackup, restoreBackup } from "@/lib/backup";
import { resetPrismaMock } from "../helpers/prismaMock";
import { jsonRequest, rawRequest, readJson } from "../helpers/http";

const coletar = vi.mocked(collectBackup);
const restaurar = vi.mocked(restoreBackup);

beforeEach(() => {
  resetPrismaMock();
  coletar.mockReset();
  restaurar.mockReset();
});

const backupVazio = {
  formatVersion: 1,
  app: "FinancialController",
  generatedAt: "2026-08-29T12:00:00.000Z",
  counts: {},
  data: {
    categories: [],
    creditCards: [],
    invoices: [],
    transactions: [],
    transactionItems: [],
    investmentHoldings: [],
    dashboardViews: [],
    familyTransactions: [],
    rentalSettlements: [],
    seasonalRentals: [],
    seasonalRentalExpenses: [],
  },
};

describe("GET /api/backup/export", () => {
  it("devolve o backup em JSON", async () => {
    coletar.mockResolvedValue(backupVazio as never);

    const res = await EXPORT();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(backupVazio);
  });

  it("força o download com um nome de arquivo com data e hora locais", async () => {
    coletar.mockResolvedValue(backupVazio as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 14, 35, 0));

    const res = await EXPORT();

    const disposition = res.headers.get("content-disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain('filename="backup-financeiro-2026-08-29-1435.json"');
    vi.useRealTimers();
  });

  it("preenche com zero à esquerda mês, dia e hora", async () => {
    coletar.mockResolvedValue(backupVazio as never);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 9, 7, 0));

    const res = await EXPORT();

    expect(res.headers.get("content-disposition")).toContain(
      'filename="backup-financeiro-2026-01-05-0907.json"',
    );
    vi.useRealTimers();
  });

  it("não deixa o backup ser cacheado", async () => {
    coletar.mockResolvedValue(backupVazio as never);
    const res = await EXPORT();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gera o JSON indentado (dá para inspecionar à mão)", async () => {
    coletar.mockResolvedValue(backupVazio as never);
    const res = await EXPORT();
    expect(await res.text()).toContain('\n  "formatVersion"');
  });
});

describe("POST /api/backup/restore — validação do modo", () => {
  it("recusa 400 quando o modo não é informado", async () => {
    const { status, body } = await readJson(
      await RESTORE(jsonRequest("POST", "/api/backup/restore", backupVazio)),
    );

    expect(status).toBe(400);
    expect(body.error).toContain('"mode"');
    expect(restaurar).not.toHaveBeenCalled();
  });

  it("recusa 400 quando o modo é desconhecido", async () => {
    const { status } = await readJson(
      await RESTORE(
        jsonRequest("POST", "/api/backup/restore", backupVazio, { mode: "sobrescrever" }),
      ),
    );
    expect(status).toBe(400);
  });

  it("aceita os dois modos válidos", async () => {
    restaurar.mockResolvedValue({
      mode: "replace",
      inserted: {},
      totalInserted: 0,
      fileCounts: {},
    });

    for (const mode of ["replace", "merge"] as const) {
      const { status } = await readJson(
        await RESTORE(jsonRequest("POST", "/api/backup/restore", backupVazio, { mode })),
      );
      expect(status).toBe(200);
    }
    expect(restaurar).toHaveBeenCalledTimes(2);
    expect(restaurar.mock.calls[0][1]).toBe("replace");
    expect(restaurar.mock.calls[1][1]).toBe("merge");
  });
});

describe("POST /api/backup/restore — validação do arquivo", () => {
  it("recusa 400 quando o corpo não é JSON válido", async () => {
    const { status, body } = await readJson(
      await RESTORE(
        rawRequest("POST", "/api/backup/restore?mode=merge", '{"formatVersion":1,"data":'),
      ),
    );

    expect(status).toBe(400);
    expect(body.error).toContain("não é um JSON válido");
    expect(restaurar).not.toHaveBeenCalled();
  });

  it("recusa 400 quando o arquivo não tem o formato de backup", async () => {
    const { status, body } = await readJson(
      await RESTORE(
        jsonRequest("POST", "/api/backup/restore", { foo: "bar" }, { mode: "merge" }),
      ),
    );

    expect(status).toBe(400);
    expect(body.error).toContain("não tem o formato de um backup");
    expect(body.details).toBeDefined();
  });

  it("recusa 400 explicando quando o backup é de uma versão futura do formato", async () => {
    const { status, body } = await readJson(
      await RESTORE(
        jsonRequest(
          "POST",
          "/api/backup/restore",
          { ...backupVazio, formatVersion: BACKUP_FORMAT_VERSION + 1 },
          { mode: "merge" },
        ),
      ),
    );

    expect(status).toBe(400);
    expect(body.error).toContain(`versão ${BACKUP_FORMAT_VERSION + 1}`);
    expect(body.error).toContain("Atualize o app");
    expect(restaurar).not.toHaveBeenCalled();
  });

  it("aceita a versão atual do formato", async () => {
    restaurar.mockResolvedValue({
      mode: "merge",
      inserted: {},
      totalInserted: 0,
      fileCounts: {},
    });

    const { status } = await readJson(
      await RESTORE(
        jsonRequest(
          "POST",
          "/api/backup/restore",
          { ...backupVazio, formatVersion: BACKUP_FORMAT_VERSION },
          { mode: "merge" },
        ),
      ),
    );

    expect(status).toBe(200);
  });

  it("não trata corpo nulo como versão futura (cai na validação de formato)", async () => {
    const { status, body } = await readJson(
      await RESTORE(rawRequest("POST", "/api/backup/restore?mode=merge", "null")),
    );

    expect(status).toBe(400);
    expect(body.error).toContain("não tem o formato de um backup");
  });
});

describe("POST /api/backup/restore — resultado", () => {
  it("devolve o relatório da restauração", async () => {
    const resultado = {
      mode: "replace" as const,
      inserted: { categories: 17, transactions: 50 },
      totalInserted: 67,
      fileCounts: { categories: 17, transactions: 50 },
    };
    restaurar.mockResolvedValue(resultado);

    const { status, body } = await readJson(
      await RESTORE(jsonRequest("POST", "/api/backup/restore", backupVazio, { mode: "replace" })),
    );

    expect(status).toBe(200);
    expect(body).toEqual(resultado);
  });

  it("responde 500 explicando que nada foi alterado quando a restauração falha", async () => {
    restaurar.mockRejectedValue(new Error("Foreign key constraint violated"));

    const { status, body } = await readJson(
      await RESTORE(jsonRequest("POST", "/api/backup/restore", backupVazio, { mode: "merge" })),
    );

    expect(status).toBe(500);
    expect(body.error).toContain("NADA foi alterado");
    expect(body.error).toContain("substituir tudo");
    expect(body.details).toBe("Foreign key constraint violated");
  });

  it("converte para texto uma falha que não é Error", async () => {
    restaurar.mockRejectedValue("falha crua");

    const { status, body } = await readJson(
      await RESTORE(jsonRequest("POST", "/api/backup/restore", backupVazio, { mode: "merge" })),
    );

    expect(status).toBe(500);
    expect(body.details).toBe("falha crua");
  });
});
