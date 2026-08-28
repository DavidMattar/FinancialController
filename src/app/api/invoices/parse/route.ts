import { NextResponse } from "next/server";
import { extractPdfLines } from "@/lib/pdf";
import { findInvoiceParser } from "@/lib/invoiceParsers";
import { deriveReferenceMonthFromFilename, suggestCategoriesBulk } from "@/lib/invoices";

/**
 * POST /api/invoices/parse
 *
 * Primeira etapa (de duas) do fluxo de importação de fatura de cartão de
 * crédito: "parse" (extrair e pré-visualizar) seguido depois por "confirm"
 * (gravar no banco). Esse endpoint NUNCA grava nada no banco — ele só lê o
 * PDF, extrai os lançamentos e devolve tudo para o usuário revisar na tela
 * antes de confirmar a importação em /api/invoices/confirm. Isso existe
 * porque a extração de PDF pode errar (ex.: um valor lido incorretamente),
 * então o usuário precisa poder revisar/corrigir antes de qualquer coisa
 * ser salva de verdade.
 *
 * Espera um `multipart/form-data` com:
 * - file: o PDF da fatura.
 * - password: senha do PDF, se ele estiver protegido (opcional).
 * - referenceMonth: mês de referência da fatura no formato "YYYY-MM"; se
 *   não for enviado, tenta descobrir automaticamente pelo nome do arquivo.
 *
 * Passos:
 * 1. Extrai o texto do PDF em linhas (`extractPdfLines`, usa pdfjs-dist).
 * 2. Descobre qual banco emitiu a fatura e usa o parser correspondente
 *    (`findInvoiceParser` — hoje só há suporte para Santander).
 * 3. Interpreta as linhas em lançamentos estruturados (`parser.parse`).
 * 4. Para cada lançamento, sugere automaticamente uma categoria com base
 *    na descrição (`suggestCategoriesBulk`), para o usuário já ver uma
 *    sugestão pré-selecionada na tela de revisão.
 * 5. Monta a lista de cartões/titulares distintos encontrados na fatura
 *    (uma fatura pode ter lançamentos de vários cartões adicionais).
 *
 * Retorna todos os dados da fatura + lançamentos com sugestão de categoria,
 * para a tela de pré-visualização no frontend.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const password = formData.get("password");
  const referenceMonthOverride = formData.get("referenceMonth");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let lines: string[];
  try {
    lines = await extractPdfLines(buffer, typeof password === "string" ? password : undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao ler o PDF.";
    const isPasswordIssue = /password/i.test(message);
    return NextResponse.json(
      { error: isPasswordIssue ? "Senha do PDF incorreta ou ausente." : message },
      { status: 400 },
    );
  }

  const parser = findInvoiceParser(lines);
  if (!parser) {
    return NextResponse.json(
      { error: "Formato de fatura não reconhecido. Bancos suportados: Santander." },
      { status: 422 },
    );
  }

  const referenceMonth =
    typeof referenceMonthOverride === "string" && referenceMonthOverride
      ? referenceMonthOverride
      : deriveReferenceMonthFromFilename(file.name);

  const parsed = parser.parse(lines, referenceMonth);
  if (parsed.transactions.length === 0) {
    return NextResponse.json(
      { error: "Nenhum lançamento foi identificado nesta fatura." },
      { status: 422 },
    );
  }

  const suggestions = await suggestCategoriesBulk(parsed.transactions.map((t) => t.description));

  const cardsSet = new Map<string, { holderName: string; lastDigits: string }>();
  for (const t of parsed.transactions) {
    cardsSet.set(`${t.cardHolder}|${t.cardLastDigits}`, {
      holderName: t.cardHolder,
      lastDigits: t.cardLastDigits,
    });
  }

  return NextResponse.json({
    bank: parsed.bank,
    referenceMonth: parsed.referenceMonth,
    dueDate: parsed.dueDate,
    totalAmount: parsed.totalAmount,
    minPayment: parsed.minPayment,
    computedTotal: parsed.computedTotal,
    fileName: file.name,
    cards: Array.from(cardsSet.values()),
    transactions: parsed.transactions.map((t) => ({
      ...t,
      suggestedCategory: suggestions.get(t.description) ?? null,
    })),
  });
}
