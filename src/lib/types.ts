// Tipos TypeScript compartilhados entre componentes do lado do cliente
// (browser). Eles espelham o formato dos dados que as rotas de API
// retornam em JSON — ou seja, não são os tipos do Prisma (que representam
// linhas do banco), e sim o formato já serializado para o front-end
// (por exemplo, valores decimais do banco chegam aqui como `string`, pois é
// assim que o JSON os representa depois de passar por `JSON.stringify`).

/** Uma categoria de transação (ex: "Alimentação", "Transporte", "Salário"). */
export interface Category {
  id: string;
  name: string;
  /** Cor usada para identificar visualmente a categoria em gráficos e listas (ex: "#FF0000"). */
  color: string;
  /** Nome do ícone a exibir junto com a categoria. */
  icon: string;
  /** Se é uma categoria de despesa ou de receita — controla onde ela aparece nos formulários. */
  kind: "EXPENSE" | "INCOME";
  /** Palavras-chave usadas para sugerir automaticamente essa categoria (ver `categorize.ts`). */
  keywords: string[];
  /** Se despesas dessa categoria devem ser abatidas do "saldo livre" no orçamento mensal. */
  deductsFromFreeSpend?: boolean;
  /** Sub-itens fixos criados automaticamente para transações dessa categoria (ver `transactionItems.ts`). */
  fixedSubItems?: string[];
  /**
   * Posição escolhida pelo usuário na tela de Categorias. A lista já chega
   * ordenada por ela de `GET /api/categories`, então as telas só precisam
   * renderizar na ordem recebida — o campo é opcional porque nenhuma delas
   * precisa lê-lo (só a própria tela de Categorias, para reordenar).
   */
  sortOrder?: number;
}

/** Dados de um cartão de crédito cadastrado (usado para associar transações importadas de fatura). */
export interface CreditCardInfo {
  id: string;
  bank: string;
  /** Nome do titular do cartão (uma fatura pode ter mais de um titular/cartão). */
  holderName: string;
  /** Últimos 4 dígitos do número do cartão, usados para diferenciar cartões do mesmo titular/banco. */
  lastDigits: string;
}

/** Uma transação financeira pessoal (do usuário principal, não da "Família"). */
export interface Transaction {
  id: string;
  /** Data da transação, como string "YYYY-MM-DD" ou ISO completo — sempre parseie com `parseLocalDate` para strings curtas. */
  date: string;
  description: string;
  /** Valor da transação. Vem como `string` quando serializado de um `Decimal` do Prisma. */
  amount: string | number;
  currency: string;
  /** Valor equivalente em dólar, se a compra foi feita no exterior. */
  amountUsd?: string | number | null;
  /** Se é uma despesa, uma receita ou um pagamento de fatura de cartão. */
  type: "EXPENSE" | "INCOME" | "PAYMENT";
  /** Seção da fatura de onde a transação foi importada (só relevante para transações vindas de fatura). */
  section?: "DESPESA" | "CREDITO" | "PARCELAMENTO" | null;
  installmentCurrent?: number | null;
  installmentTotal?: number | null;
  /** Se a transação foi criada manualmente pelo usuário ou importada (fatura/recibo). */
  source: "MANUAL" | "IMPORT";
  categoryId?: string | null;
  category?: Category | null;
  creditCardId?: string | null;
  creditCard?: CreditCardInfo | null;
  notes?: string | null;
  /** Se é uma compra de e-commerce que o usuário marcou como possível devolução pendente. */
  pendingReturn?: boolean;
}

/** Uma transação do livro-caixa isolado "Família" (ver seção de Transações Família). */
export interface FamilyTransaction {
  id: string;
  date: string;
  description: string;
  amount: string | number;
  type: "EXPENSE" | "INCOME";
  notes?: string | null;
}
