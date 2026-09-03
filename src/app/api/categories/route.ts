import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Formato aceito para criar uma categoria.
 * - kind: "EXPENSE" (gasto) ou "INCOME" (receita). Categorias INCOME travam
 *   automaticamente o tipo de qualquer transação associada a elas (ver
 *   regra em /api/transactions).
 * - keywords: lista de palavras-chave usadas por `suggestCategoryId`
 *   (em @/lib/categorize) para sugerir automaticamente essa categoria
 *   quando a descrição de uma transação contém uma dessas palavras.
 * - deductsFromFreeSpend: se true, gastos nessa categoria descontam do
 *   valor "livre para gastar" (os 15% do orçamento mensal) mostrado no
 *   banner do dashboard.
 */
const createSchema = z.object({
  name: z.string().min(1),
  color: z.string().default("#6366f1"),
  icon: z.string().default("tag"),
  kind: z.enum(["EXPENSE", "INCOME"]).default("EXPENSE"),
  keywords: z.array(z.string()).default([]),
  deductsFromFreeSpend: z.boolean().default(false),
});

/**
 * Formato aceito no PATCH da COLEÇÃO (reordenação): a lista completa de ids
 * na ordem desejada. A ordem é enviada inteira, como um bloco só, porque é
 * assim que ela é lida — não existe "mover a categoria X para a posição 3"
 * sem dizer o que acontece com as outras.
 */
const reorderSchema = z.object({
  order: z.array(z.string().min(1)).min(1),
});

/**
 * GET /api/categories
 *
 * Lista todas as categorias cadastradas na ordem escolhida pelo usuário na
 * tela de Categorias (`sortOrder`), com o nome como desempate.
 *
 * Esta é a ÚNICA rota que decide a ordem das categorias no app: os selects de
 * categoria da tabela de transações, os filtros do dashboard e de /relatorios e
 * as telas de importação todos renderizam a lista na ordem em que ela chega
 * daqui. É o que faz a reordenação valer em toda a interface de uma vez, sem
 * cada tela ordenar por conta própria.
 *
 * O nome como segundo critério não é enfeite: `sortOrder` nasce 0 para todas
 * as categorias (o padrão da coluna), então antes da primeira reordenação — e
 * numa instalação nova — a lista sai em ordem alfabética, exatamente como
 * saía antes desta coluna existir.
 */
export async function GET() {
  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(categories);
}

/**
 * POST /api/categories
 *
 * Cria uma nova categoria (de gasto ou receita) com cor, ícone, palavras-chave
 * para auto-categorização e a flag de desconto do "livre para gastar".
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // A categoria nova entra no FIM da ordem escolhida, não no padrão 0: depois
  // de uma reordenação todas as posições valem 0..n-1, e nascer com 0 faria a
  // categoria recém-criada pular para o topo de todas as listas do app.
  const last = await prisma.category.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const category = await prisma.category.create({
    data: { ...parsed.data, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(category, { status: 201 });
}

/**
 * PATCH /api/categories
 *
 * Regrava a ordem das categorias (as setas ↑/↓ da tela de Categorias).
 *
 * É um PATCH na COLEÇÃO, e não em /api/categories/[id], porque reordenar não é
 * editar um campo de uma categoria: mover uma para cima muda a posição de
 * outra. Como caminho fixo, também não disputa a rota com o segmento dinâmico
 * `[id]` — um "/api/categories/reorder" seria um id válido para a outra rota.
 *
 * O corpo tem que trazer TODOS os ids existentes, exatamente uma vez cada. Um
 * subconjunto (ou um id repetido/desconhecido) é recusado com 400 em vez de
 * gravado pela metade: é o que garante que `sortOrder` continue sendo uma
 * permutação de 0..n-1, sem empate nem furo. Se a tela estiver com uma lista
 * velha (categoria criada ou excluída em outra aba), o 400 aparece no pop-up
 * global de erro pedindo para recarregar — bem melhor que uma ordem
 * silenciosamente pela metade.
 *
 * As gravações vão numa transação do Postgres só: ou a ordem nova vale
 * inteira, ou o banco fica exatamente como estava.
 */
export async function PATCH(request: Request) {
  const body = await request.json();
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { order } = parsed.data;

  const existing = await prisma.category.findMany({ select: { id: true } });
  const existingIds = new Set(existing.map((c) => c.id));
  const orderIds = new Set(order);
  if (orderIds.size !== order.length || orderIds.size !== existingIds.size || order.some((id) => !existingIds.has(id))) {
    return NextResponse.json(
      {
        error:
          "A ordem enviada precisa conter todas as categorias existentes, uma vez cada. Recarregue a página e tente de novo.",
      },
      { status: 400 },
    );
  }

  await prisma.$transaction(
    order.map((id, index) => prisma.category.update({ where: { id }, data: { sortOrder: index } })),
  );

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(categories);
}
