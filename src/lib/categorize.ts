import { prisma } from "./prisma";

/**
 * Tenta descobrir automaticamente a categoria de uma transação com base na
 * sua descrição (ex: o nome do estabelecimento numa fatura de cartão).
 *
 * Como funciona: cada categoria cadastrada pode ter uma lista de
 * "palavras-chave" (ex: a categoria "Transporte" pode ter ["UBER", "99APP"]).
 * Esta função pega a descrição da transação, deixa tudo em CAIXA ALTA, e
 * procura se alguma palavra-chave de alguma categoria aparece dentro dela.
 * A primeira categoria cuja palavra-chave for encontrada é retornada.
 *
 * @param description - Texto da transação (ex: "UBER *TRIP 123").
 * @returns O id da categoria encontrada, ou `null` se nenhuma palavra-chave bateu.
 */
export async function suggestCategoryId(description: string): Promise<string | null> {
  const categories = await prisma.category.findMany({
    select: { id: true, keywords: true },
  });
  const desc = description.toUpperCase();
  for (const category of categories) {
    for (const keyword of category.keywords) {
      if (keyword && desc.includes(keyword.toUpperCase())) {
        return category.id;
      }
    }
  }
  return null;
}
