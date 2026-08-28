import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Guarda o client do Prisma numa variável global do processo Node.
// Por que isso existe: no modo de desenvolvimento do Next.js, o código do
// servidor é recarregado a cada mudança (hot reload). Sem esse truque, cada
// reload criaria um PrismaClient novo, e cada um abre suas próprias conexões
// com o Postgres — em poucos minutos de desenvolvimento isso esgotaria o
// limite de conexões do banco. Guardando o client no `globalThis`, ele
// sobrevive aos reloads e é reaproveitado.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Cria uma nova instância do PrismaClient conectada ao Postgres local.
 *
 * Por que usa um "adapter" (PrismaPg) em vez do jeito padrão do Prisma:
 * a partir da versão 7, o Prisma parou de embutir um motor de banco de dados
 * compilado (o "query engine" binário) e passou a exigir um adapter que fala
 * diretamente com o driver do banco (aqui, o pacote `pg`, o driver oficial
 * de PostgreSQL para Node.js). O adapter recebe a string de conexão
 * (DATABASE_URL, definida no arquivo .env) e é isso que o PrismaClient usa
 * para saber como conversar com o banco.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

// Exporta uma única instância do Prisma para todo o app usar.
// Se já existe uma instância salva na variável global (por causa de um hot
// reload anterior), reaproveita ela. Se não existe (primeira vez que o
// servidor sobe), cria uma nova.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Em desenvolvimento, guarda a instância na variável global para o próximo
// hot reload poder reaproveitá-la (ver explicação acima). Em produção não
// precisa, porque o servidor não fica recarregando o código o tempo todo.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
