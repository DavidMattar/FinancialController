import { NextResponse } from "next/server";
import { extractPdfLines } from "@/lib/pdf";
import { parseReceipt } from "@/lib/receiptParsers";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/receipts/parse
 *
 * Primeira etapa (de duas) do fluxo de importação de nota fiscal de
 * supermercado (NFC-e — Nota Fiscal de Consumidor Eletrônica). Assim como
 * em /api/invoices/parse, esse endpoint só LÊ e interpreta a nota, sem
 * gravar nada no banco — o usuário revisa o resultado na tela antes de
 * confirmar em /api/receipts/confirm.
 *
 * Aceita `multipart/form-data` com um dos dois:
 * - file: um PDF da nota fiscal (extraído com `extractPdfLines`, via
 *   pdfjs-dist).
 * - text: o texto da nota colado manualmente (usado quando o usuário não
 *   tem o PDF, só o texto copiado da página da nota).
 *
 * `parseReceipt` (em @/lib/receiptParsers) interpreta o formato de NFC-e
 * brasileiro, procurando por linhas no padrão:
 * "<DESCRIÇÃO> (Código: <código>) Qtde total de ítens: <qtd> UN: <unidade>
 * Valor total R$: R$ <valor>" — note que a quantidade usa PONTO decimal e
 * o valor em R$ usa VÍRGULA decimal; essa é uma inconsistência real do
 * formato de origem, não um bug do parser.
 *
 * Depois de interpretar os itens, sugere automaticamente a categoria
 * "Supermercado" (se ela existir cadastrada) para a tela de revisão.
 *
 * Retorna os dados da loja, data, totais e itens extraídos, prontos para
 * o usuário revisar antes de confirmar a importação.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const pastedText = formData.get("text");

  let lines: string[];
  if (file instanceof File) {
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      lines = await extractPdfLines(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao ler o PDF.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } else if (typeof pastedText === "string" && pastedText.trim()) {
    lines = pastedText.split("\n");
  } else {
    return NextResponse.json({ error: "Envie um arquivo PDF ou cole o texto da nota." }, { status: 400 });
  }

  const parsed = parseReceipt(lines);
  if (!parsed || parsed.items.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível identificar os itens desta nota fiscal. Formato ainda não suportado." },
      { status: 422 },
    );
  }

  const supermercado = await prisma.category.findFirst({ where: { name: "Supermercado" } });

  return NextResponse.json({
    storeName: parsed.storeName,
    cnpj: parsed.cnpj ?? null,
    date: parsed.date ?? null,
    officialTotal: parsed.officialTotal ?? null,
    computedTotal: parsed.computedTotal,
    suggestedCategoryId: supermercado?.id ?? null,
    items: parsed.items,
  });
}
