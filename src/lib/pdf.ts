/**
 * Extrai o texto de um arquivo PDF, linha por linha, na ordem em que o texto
 * aparece no arquivo (equivalente ao comando `pdftotext -raw`).
 *
 * Por que não usa o modo "layout" do pdftotext/pdfjs: faturas de cartão têm
 * várias colunas (data, descrição, valor) e o modo "layout" tenta realinhar
 * tudo em colunas visuais, o que embaralha a ordem das colunas em muitos PDFs
 * de bancos. Já o modo "raw" preserva a ordem natural em que o texto foi
 * desenhado no PDF, que nos testes bateu corretamente com a ordem
 * data/descrição/valor usada pelos parsers de fatura (ver `invoiceParsers/`).
 *
 * @param buffer - Conteúdo binário do arquivo PDF.
 * @param password - Senha do PDF, se ele estiver protegido (ex: faturas do
 *   Santander são protegidas por CPF).
 * @returns Uma lista de strings, uma por linha de texto extraída.
 * @throws Erro do pdfjs-dist se a senha estiver incorreta ou faltando — o
 *   chamador deve capturar e tratar isso convertendo para `PdfPasswordError`
 *   quando apropriado.
 */
export async function extractPdfLines(buffer: Buffer, password?: string): Promise<string[]> {
  // Import dinâmico: a build "legacy" do pdfjs-dist é a que funciona em
  // ambiente Node (sem APIs de navegador) usada pelas rotas de API do servidor.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const loadingTask = pdfjsLib.getDocument({ data, password });
  const doc = await loadingTask.promise;

  const lines: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    let current = "";
    for (const item of content.items as { str: string; hasEOL?: boolean }[]) {
      current += item.str;
      // `hasEOL` marca o fim de uma linha visual no PDF original — é assim
      // que reconstruímos as quebras de linha, já que o pdfjs não as retorna
      // como caracteres "\n" dentro do texto.
      if (item.hasEOL) {
        lines.push(current);
        current = "";
      }
    }
    if (current) lines.push(current);
  }
  await loadingTask.destroy();
  return lines;
}

/** Erro lançado quando um PDF protegido por senha não pôde ser aberto (senha errada ou não informada). */
export class PdfPasswordError extends Error {
  constructor() {
    super("PDF protegido por senha incorreta ou senha necessária.");
    this.name = "PdfPasswordError";
  }
}
