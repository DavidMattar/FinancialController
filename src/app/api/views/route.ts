import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

const createSchema = z.object({
  name: z.string().min(1),
  filters: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().default(false),
});

/**
 * GET /api/views
 * Lista todas as visualizações salvas do dashboard (conjuntos de filtros nomeados
 * que o usuário pode reaplicar com um clique), na ordem em que foram criadas.
 */
export async function GET() {
  const views = await prisma.dashboardView.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(views);
}

/**
 * POST /api/views
 * Salva uma nova visualização de dashboard: um nome e um objeto `filters` livre
 * (JSON) com os filtros atualmente aplicados na tela. Se `isDefault` vier true,
 * primeiro desmarca qualquer outra visualização marcada como padrão — só pode
 * existir uma visualização padrão por vez, que é a carregada automaticamente
 * ao abrir o dashboard.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  if (data.isDefault) {
    await prisma.dashboardView.updateMany({ data: { isDefault: false } });
  }
  const view = await prisma.dashboardView.create({
    data: { ...data, filters: data.filters as Prisma.InputJsonValue },
  });
  return NextResponse.json(view, { status: 201 });
}
