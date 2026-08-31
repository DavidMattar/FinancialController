import { NextResponse } from "next/server";
import { z } from "zod";
import { decimalField } from "@/lib/decimalInput";
import { aggregatePurchases } from "@/lib/investments";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  type: z.enum(["CRYPTO", "CURRENCY"]),
  symbol: z.string().min(1),
  name: z.string().min(1),
  /** Quantidade comprada NESTE aporte. */
  quantity: decimalField(z.number().positive()),
  /**
   * Reais pagos por UMA unidade do ativo neste aporte (ex: 402058 = o preço de
   * 1 BTC). Não é "quanto de cripto um real compra", e também não é mais um
   * custo médio: a média é derivada da soma das compras.
   */
  unitCostBrl: decimalField(z.number().nonnegative()),
  notes: z.string().nullable().optional(),
});

/**
 * GET /api/investments
 * Lista as posições de investimento cadastradas, na ordem de criação, cada uma
 * já com suas compras e com a quantidade/custo médio DERIVADOS delas (o banco
 * não guarda esses dois — ver src/lib/investments.ts).
 * Não busca cotação aqui; isso é /api/investments/prices.
 */
export async function GET() {
  const holdings = await prisma.investmentHolding.findMany({
    orderBy: { createdAt: "asc" },
    include: { purchases: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json(
    holdings.map((holding) => ({ ...holding, ...aggregatePurchases(holding.purchases) })),
  );
}

/**
 * POST /api/investments
 * Registra uma COMPRA de um ativo (ex: "0.5 BTC a R$ 402.058 por unidade").
 * Espera { type, symbol, name, quantity, unitCostBrl, notes? }.
 *
 * **Cadastrar de novo um ativo que já existe não é erro: é uma segunda compra.**
 * O schema tem `@@unique([type, symbol])`, então existe uma única posição por
 * tipo+símbolo — antes disso um segundo cadastro estourava a constraint, virava
 * 500, e o formulário (que ignorava o status da resposta) fechava sem mensagem.
 * Agora a compra entra como um `InvestmentPurchase` novo da posição que já
 * existe: nada é sobrescrito, e o total e o custo médio da posição passam a
 * incluí-la porque são a soma das compras.
 *
 * Nome e descrição da posição existente são preservados de propósito — a
 * segunda compra fala de quantidade e preço, não da identidade do ativo. Para
 * corrigir esses dois campos há a coluna "Descrição" (editável na tabela) e o
 * PATCH de /api/investments/[id].
 *
 * @returns 201 com a posição criada, ou 200 com `merged: true` quando a compra
 *   entrou numa posição que já existia — é o que faz a tela avisar que somou,
 *   em vez de parecer que não fez nada por não ter aparecido linha nova.
 */
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { type, symbol, name, quantity, unitCostBrl, notes } = parsed.data;

  const existing = await prisma.investmentHolding.findUnique({
    where: { type_symbol: { type, symbol } },
  });
  if (existing) {
    const purchase = await prisma.investmentPurchase.create({
      data: { holdingId: existing.id, quantity, unitCostBrl },
    });
    return NextResponse.json({ ...existing, merged: true, purchase });
  }

  // Posição nova: identidade do ativo e a primeira compra nascem juntas, para
  // não existir posição sem compra nenhuma (que apareceria com total zero).
  const holding = await prisma.investmentHolding.create({
    data: {
      type,
      symbol,
      name,
      notes,
      purchases: { create: { quantity, unitCostBrl } },
    },
    include: { purchases: true },
  });
  return NextResponse.json(holding, { status: 201 });
}
