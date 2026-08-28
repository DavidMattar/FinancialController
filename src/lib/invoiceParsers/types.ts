/**
 * Seção da fatura de onde a transação foi extraída:
 * - DESPESA: compra normal (aumenta o quanto você deve).
 * - CREDITO: pagamento da fatura ou estorno/reembolso (diminui o quanto você deve).
 * - PARCELAMENTO: parcela de uma compra que já foi dividida em várias faturas.
 */
export type InvoiceSection = "DESPESA" | "CREDITO" | "PARCELAMENTO";

/** Tipo final da transação depois de interpretada (mesmo enum usado pelo banco de dados). */
export type TransactionType = "EXPENSE" | "INCOME" | "PAYMENT";

/**
 * Uma única linha de lançamento extraída do PDF da fatura (uma compra, um
 * pagamento, uma parcela, etc.), já convertida para valores utilizáveis
 * (números e Date) em vez do texto bruto do PDF.
 */
export interface ParsedTransaction {
  /** Data em que a compra/lançamento foi feito. */
  date: Date;
  /** Descrição do lançamento (nome do estabelecimento, geralmente em caixa alta). */
  description: string;
  /** Valor em reais, sempre positivo — o sinal (gasto/crédito) é indicado pelo campo `type`. */
  amount: number;
  /** Valor equivalente em dólar, quando a compra foi feita no exterior (opcional). */
  amountUsd?: number;
  /** Se é uma despesa, uma receita/estorno ou um pagamento de fatura. */
  type: TransactionType;
  /** De qual seção da fatura essa linha foi extraída (ver `InvoiceSection`). */
  section: InvoiceSection;
  /** Número da parcela atual, se a compra foi parcelada (ex: 2 de 2/10). */
  installmentCurrent?: number;
  /** Número total de parcelas, se a compra foi parcelada. */
  installmentTotal?: number;
  /** Nome de quem é o titular do cartão que fez essa compra (fatura pode ter vários cartões/pessoas). */
  cardHolder: string;
  /** Últimos 4 dígitos do cartão usado nessa compra. */
  cardLastDigits: string;
}

/**
 * Resultado completo da leitura de uma fatura de cartão de crédito: os dados
 * gerais da fatura mais a lista de todos os lançamentos encontrados.
 */
export interface ParsedInvoice {
  /** Nome do banco emissor (ex: "Santander"). */
  bank: string;
  /** Mês de referência da fatura, no formato "YYYY-MM". */
  referenceMonth: string;
  /** Data de vencimento da fatura, se foi possível encontrar no PDF. */
  dueDate?: Date;
  /** Valor total "oficial" da fatura, do jeito que o banco informou no PDF. */
  totalAmount: number;
  /** Valor mínimo para pagamento, se informado no PDF. */
  minPayment?: number;
  /** Valor total calculado por nós somando todos os lançamentos (serve para conferir se bate com `totalAmount`). */
  computedTotal: number;
  /** Todos os lançamentos (compras, pagamentos, parcelas) encontrados na fatura. */
  transactions: ParsedTransaction[];
}

/**
 * Contrato que todo "leitor de fatura" (um por banco) precisa seguir. Isso
 * permite adicionar suporte a novos bancos no futuro sem precisar mudar o
 * código que decide qual leitor usar (ver `invoiceParsers/index.ts`).
 */
export interface InvoiceParser {
  /** Nome do banco que esse parser sabe interpretar. */
  bank: string;
  /** Checagem rápida: "esse texto parece ser uma fatura desse banco?" */
  matches(lines: string[]): boolean;
  /** Faz a leitura de fato, transformando as linhas de texto em dados estruturados. */
  parse(lines: string[], referenceMonth: string): ParsedInvoice;
}
