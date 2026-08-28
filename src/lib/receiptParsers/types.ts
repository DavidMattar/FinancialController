/** Um item comprado, extraído de uma nota fiscal (NFC-e) de supermercado. */
export interface ParsedReceiptItem {
  /** Nome do produto, como impresso na nota. */
  description: string;
  /** Código interno do produto usado pelo estabelecimento (não é código de barras). */
  code: string;
  /** Quantidade comprada (pode ser fracionária para itens vendidos por peso, ex: 1.5 kg). */
  quantity: number;
  /** Unidade de medida (ex: "UN", "KG"). */
  unit: string;
  /** Valor total pago por esse item (quantidade × preço unitário), sempre positivo. */
  amount: number;
}

/** Resultado completo da leitura de uma nota fiscal de supermercado (NFC-e). */
export interface ParsedReceipt {
  /** Nome do estabelecimento. */
  storeName: string;
  /** CNPJ do estabelecimento, se encontrado no texto da nota. */
  cnpj?: string;
  /** Data/hora de emissão da nota, se encontrada. */
  date?: Date;
  /** Valor total "oficial" impresso na nota (usado para conferência). */
  officialTotal?: number;
  /** Valor total calculado por nós somando o `amount` de cada item. */
  computedTotal: number;
  /** Todos os itens comprados, na ordem em que aparecem na nota. */
  items: ParsedReceiptItem[];
}
