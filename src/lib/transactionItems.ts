import { prisma } from "./prisma";

/**
 * Garante que uma transação tenha os "sub-itens fixos" da sua categoria já
 * criados (ex: a categoria "Viagem" pode definir sub-itens fixos como
 * "Hospedagem", "Passagem", "Alimentação" — sempre que uma transação for
 * marcada com essa categoria, esses sub-itens devem existir para o usuário
 * preencher os valores).
 *
 * A função é idempotente: só cria os sub-itens que ainda não existem para
 * essa transação (compara pela descrição), então pode ser chamada várias
 * vezes sem duplicar nada — por exemplo, se o usuário trocar a categoria da
 * transação de um lado para o outro e voltar.
 *
 * @param transactionId - Id da transação que recebeu/mudou de categoria.
 * @param categoryId - Id da nova categoria da transação. Se for `null`/`undefined`,
 *   a função não faz nada (transação sem categoria não tem sub-itens fixos).
 */
export async function ensureFixedSubItems(transactionId: string, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { fixedSubItems: true },
  });
  if (!category || category.fixedSubItems.length === 0) return;

  const existing = await prisma.transactionItem.findMany({
    where: { transactionId },
    select: { description: true },
  });
  const existingDescriptions = new Set(existing.map((e) => e.description));
  const toCreate = category.fixedSubItems.filter((d) => !existingDescriptions.has(d));
  if (toCreate.length === 0) return;

  // Sub-itens são criados com valor zero — o usuário preenche o valor real
  // depois, editando a transação.
  await prisma.transactionItem.createMany({
    data: toCreate.map((description) => ({ transactionId, description, amount: 0 })),
  });
}
