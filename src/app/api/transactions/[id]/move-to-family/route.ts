import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Tradução do tipo da transação do ledger principal para o tipo do ledger da
 * família. `FamilyTransactionType` **não** tem `PAYMENT` de propósito (é um
 * enum separado justamente para reforçar que os dois ledgers são modelos
 * independentes — ver o comentário no schema), então um pagamento de fatura
 * entra na família como despesa. É a única conversão do movimento, e a tela de
 * confirmação avisa o usuário antes.
 */
const FAMILY_TYPE = {
  EXPENSE: "EXPENSE",
  INCOME: "INCOME",
  PAYMENT: "EXPENSE",
} as const;

/**
 * POST /api/transactions/[id]/move-to-family
 *
 * Move uma transação do ledger principal para o ledger isolado da família:
 * cria a `FamilyTransaction` equivalente e apaga a `Transaction` original.
 *
 * É uma rota própria (e não um PATCH em `/api/transactions/[id]`) porque não é
 * uma edição de campo: são duas tabelas sem nenhuma relação entre si, e o
 * resultado é a transação deixar de existir no ledger principal.
 *
 * **Só migram os campos que a família tem** (data, descrição, valor, tipo,
 * observação). Categoria, cartão, fatura, parcelamento, marcação de devolução
 * pendente e sub-itens **são perdidos**, porque `FamilyTransaction` não tem
 * esses campos — é o preço do isolamento proposital entre os dois ledgers, não
 * um esquecimento. Os sub-itens saem por `onDelete: Cascade`.
 *
 * As duas gravações rodam na MESMA transação do Postgres: sem isso, uma falha
 * no meio deixaria a transação duplicada nos dois ledgers (ou apagada dos
 * dois).
 *
 * Se a transação movida for a receita auto-criada de um aluguel de temporada,
 * o `SeasonalRental.transactionId` fica apontando para um id que não existe
 * mais — exatamente o que já acontece hoje ao excluir a transação, e a edição
 * do aluguel já trata esse caso (`.catch(() => {})` no PUT do aluguel).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const transaction = await prisma.transaction.findUnique({ where: { id } });
  if (!transaction) {
    return NextResponse.json({ error: "Transação não encontrada." }, { status: 404 });
  }

  const moved = await prisma.$transaction(async (tx) => {
    const familyTransaction = await tx.familyTransaction.create({
      data: {
        // A data vem do banco já como Date (instante exato), então não passa
        // por `dateOnly.ts` — a armadilha de fuso vale para string "YYYY-MM-DD".
        date: transaction.date,
        description: transaction.description,
        amount: transaction.amount,
        type: FAMILY_TYPE[transaction.type],
        notes: transaction.notes,
      },
    });
    await tx.transaction.delete({ where: { id } });
    return familyTransaction;
  });

  return NextResponse.json({
    familyTransaction: moved,
    // Devolvido para a tela poder avisar que houve conversão de tipo sem
    // precisar repetir a regra do FAMILY_TYPE no front-end.
    convertedFromPayment: transaction.type === "PAYMENT",
  });
}
