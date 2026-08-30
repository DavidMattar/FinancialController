import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O que este módulo faz de não trivial é UM truque: guardar o PrismaClient
 * numa variável global para ele sobreviver ao hot-reload do `next dev` (sem
 * isso, cada recarga abriria um novo pool de conexões e o Postgres estouraria
 * o limite). É esse comportamento — e a diferença entre dev e produção — que
 * os testes aqui cobrem. O client e o adapter são dublês: nenhuma conexão real
 * é aberta.
 */
const PrismaClient = vi.fn(function (this: Record<string, unknown>, options: unknown) {
  this.options = options;
});
const PrismaPg = vi.fn(function (this: Record<string, unknown>, config: unknown) {
  this.config = config;
});

vi.mock("@/generated/prisma/client", () => ({
  get PrismaClient() {
    return PrismaClient;
  },
}));
vi.mock("@prisma/adapter-pg", () => ({
  get PrismaPg() {
    return PrismaPg;
  },
}));

const globalComPrisma = globalThis as unknown as { prisma?: unknown };
const nodeEnvOriginal = process.env.NODE_ENV;
const databaseUrlOriginal = process.env.DATABASE_URL;

beforeEach(() => {
  PrismaClient.mockClear();
  PrismaPg.mockClear();
  delete globalComPrisma.prisma;
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://usuario:senha@localhost:5432/banco_de_teste";
});

afterEach(() => {
  delete globalComPrisma.prisma;
  // NODE_ENV é somente-leitura no tipo do Node, mas gravável em runtime — e
  // precisa voltar ao valor original para não afetar os outros arquivos.
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnvOriginal;
  process.env.DATABASE_URL = databaseUrlOriginal;
});

describe("src/lib/prisma", () => {
  it("cria o client passando o adapter do Postgres", async () => {
    const { prisma } = await import("@/lib/prisma");

    expect(prisma).toBeDefined();
    expect(PrismaPg).toHaveBeenCalledTimes(1);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
    // O client recebe o adapter, não uma URL — exigência do Prisma 7.
    const opcoes = PrismaClient.mock.calls[0][0] as { adapter: unknown };
    expect(opcoes.adapter).toBeInstanceOf(PrismaPg);
  });

  it("monta o adapter com a DATABASE_URL do ambiente", async () => {
    await import("@/lib/prisma");
    expect(PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://usuario:senha@localhost:5432/banco_de_teste",
    });
  });

  it("reaproveita a instância guardada na global (é o que sobrevive ao hot-reload)", async () => {
    const instanciaAnterior = { marcador: "instancia-de-antes-do-reload" };
    globalComPrisma.prisma = instanciaAnterior;

    const { prisma } = await import("@/lib/prisma");

    expect(prisma).toBe(instanciaAnterior);
    // O ponto do cache: nenhum client novo é construído.
    expect(PrismaClient).not.toHaveBeenCalled();
  });

  it("guarda a instância na global fora de produção", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const { prisma } = await import("@/lib/prisma");
    expect(globalComPrisma.prisma).toBe(prisma);
  });

  it("NÃO guarda a instância na global em produção", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    await import("@/lib/prisma");
    expect(globalComPrisma.prisma).toBeUndefined();
  });

  it("duas importações no mesmo processo devolvem a mesma instância", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    const primeira = (await import("@/lib/prisma")).prisma;
    // Simula o hot-reload: o módulo é reavaliado, mas a global permanece.
    vi.resetModules();
    const segunda = (await import("@/lib/prisma")).prisma;

    expect(segunda).toBe(primeira);
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  });

  it("funciona mesmo sem DATABASE_URL definida (o erro vem do adapter, não daqui)", async () => {
    delete process.env.DATABASE_URL;
    await expect(import("@/lib/prisma")).resolves.toHaveProperty("prisma");
    expect(PrismaPg).toHaveBeenCalledWith({ connectionString: undefined });
  });
});
