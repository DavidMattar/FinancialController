// Lista de palavras-chave que identificam compras feitas em sites/apps de
// e-commerce. Usada para decidir se uma transação deve mostrar a opção
// "pendente de devolução" — só faz sentido oferecer essa opção para compras
// online, que têm prazo legal de arrependimento/devolução, diferente de uma
// compra presencial num restaurante, por exemplo.
const ECOMMERCE_KEYWORDS = [
  "SHOPEE",
  "MERCADOLIVRE",
  "MERCADO LIVRE",
  "SHEIN",
  "AMAZON",
  "ALIEXPRESS",
  "ALI EXPRESS",
  "MAGALU",
  "MAGAZINE LUIZA",
  "AMERICANAS",
  "CASAS BAHIA",
  "SUBMARINO",
  "KABUM",
  "SHOPTIME",
  "NETSHOES",
  "DAFITI",
  "ZATTINI",
  "EXTRA.COM",
  "PONTOFRIO",
  "WISH",
  "TEMU",
  "EBAY",
  "ETSY",
];

/**
 * Verifica se a descrição de uma transação parece ser de uma compra num
 * site/app de e-commerce conhecido, comparando (sem diferenciar
 * maiúsculas/minúsculas) contra a lista `ECOMMERCE_KEYWORDS`.
 *
 * @param description - Descrição da transação (ex: nome do estabelecimento na fatura).
 * @returns `true` se alguma palavra-chave de e-commerce foi encontrada na descrição.
 */
export function isEcommerceMerchant(description: string): boolean {
  const desc = description.toUpperCase();
  return ECOMMERCE_KEYWORDS.some((keyword) => desc.includes(keyword));
}
