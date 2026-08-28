import { prisma } from "./prisma";

/**
 * Tenta descobrir o mês de referência de uma fatura a partir do nome do
 * arquivo enviado pelo usuário. O Santander nomeia os PDFs de fatura com um
 * padrão que inclui mês e ano juntos (ex: "Fatura_082026_cartao.pdf" = mês 08,
 * ano 2026), por isso a expressão regular procura por 2 dígitos seguidos de 4
 * dígitos em qualquer lugar do nome do arquivo.
 *
 * @param fileName - Nome original do arquivo enviado (não o caminho completo).
 * @returns O mês de referência no formato "YYYY-MM". Se o padrão não for
 *   encontrado no nome do arquivo, usa o mês/ano atual como alternativa.
 */
export function deriveReferenceMonthFromFilename(fileName: string): string {
  const match = fileName.match(/(\d{2})(\d{4})/);
  if (match) {
    const [, month, year] = match;
    return `${year}-${month}`;
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Versão "em lote" de `suggestCategoryId` (ver `categorize.ts`): em vez de
 * consultar o banco uma vez por transação, busca todas as categorias uma
 * única vez e depois testa cada descrição contra elas em memória. Usada na
 * tela de pré-visualização de importação de fatura/recibo, onde muitas
 * transações precisam ser categorizadas de uma vez.
 *
 * @param descriptions - Lista de descrições de transações a categorizar.
 * @returns Um Map de descrição -> categoria sugerida (ou `null` se nenhuma
 *   categoria bateu). Note que descrições repetidas na lista de entrada
 *   compartilham a mesma entrada no Map (a chave é a própria descrição).
 */
export async function suggestCategoriesBulk(
  descriptions: string[],
): Promise<Map<string, { id: string; name: string; color: string } | null>> {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, color: true, keywords: true },
  });
  const result = new Map<string, { id: string; name: string; color: string } | null>();
  for (const description of descriptions) {
    const desc = description.toUpperCase();
    let match: { id: string; name: string; color: string } | null = null;
    for (const category of categories) {
      if (category.keywords.some((k) => k && desc.includes(k.toUpperCase()))) {
        match = { id: category.id, name: category.name, color: category.color };
        break;
      }
    }
    result.set(description, match);
  }
  return result;
}
