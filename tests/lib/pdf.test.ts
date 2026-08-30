import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O `pdfjs-dist` é substituído por um dublê: os testes aqui são sobre a
 * RECONSTRUÇÃO DE LINHAS a partir dos "items" que o pdf.js devolve (é o
 * `hasEOL` que marca fim de linha, não um "\n" no texto) — não sobre a
 * decodificação de PDF em si, que é responsabilidade da biblioteca.
 */
const getDocument = vi.fn();
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  get getDocument() {
    return getDocument;
  },
}));

import { extractPdfLines, PdfPasswordError } from "@/lib/pdf";

type Item = { str: string; hasEOL?: boolean };

/** Monta o dublê do documento do pdf.js com uma lista de items por página. */
function documentoFake(paginas: Item[][]) {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const doc = {
    numPages: paginas.length,
    getPage: vi.fn(async (n: number) => ({
      getTextContent: async () => ({ items: paginas[n - 1] }),
    })),
  };
  getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy });
  return { doc, destroy };
}

beforeEach(() => {
  getDocument.mockReset();
});

describe("extractPdfLines", () => {
  it("junta os items em linhas, quebrando em cada hasEOL", () => {
    documentoFake([
      [
        { str: "05/08 " },
        { str: "SUPERMERCADO BH " },
        { str: "150,00", hasEOL: true },
        { str: "06/08 " },
        { str: "NETFLIX 39,90", hasEOL: true },
      ],
    ]);
    return expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual([
      "05/08 SUPERMERCADO BH 150,00",
      "06/08 NETFLIX 39,90",
    ]);
  });

  it("inclui o texto final mesmo sem hasEOL na última linha", async () => {
    documentoFake([[{ str: "linha com EOL", hasEOL: true }, { str: "sobra sem EOL" }]]);
    await expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual([
      "linha com EOL",
      "sobra sem EOL",
    ]);
  });

  it("percorre todas as páginas na ordem", async () => {
    const { doc } = documentoFake([
      [{ str: "pagina 1", hasEOL: true }],
      [{ str: "pagina 2", hasEOL: true }],
      [{ str: "pagina 3", hasEOL: true }],
    ]);
    await expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual([
      "pagina 1",
      "pagina 2",
      "pagina 3",
    ]);
    expect(doc.getPage).toHaveBeenCalledTimes(3);
    expect(doc.getPage.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });

  it("devolve lista vazia para um PDF sem texto", async () => {
    documentoFake([[]]);
    await expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual([]);
  });

  it("devolve lista vazia para um PDF sem páginas", async () => {
    documentoFake([]);
    await expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual([]);
  });

  it("não gera linha vazia quando a última linha termina em hasEOL", async () => {
    documentoFake([[{ str: "unica", hasEOL: true }]]);
    await expect(extractPdfLines(Buffer.from("pdf"))).resolves.toEqual(["unica"]);
  });

  it("entrega o conteúdo do buffer como Uint8Array para o pdf.js", async () => {
    documentoFake([[]]);
    await extractPdfLines(Buffer.from([1, 2, 3]));
    const arg = getDocument.mock.calls[0][0];
    expect(arg.data).toBeInstanceOf(Uint8Array);
    expect([...arg.data]).toEqual([1, 2, 3]);
  });

  it("repassa a senha quando informada (fatura protegida por CPF)", async () => {
    documentoFake([[]]);
    await extractPdfLines(Buffer.from("pdf"), "12345678900");
    expect(getDocument.mock.calls[0][0].password).toBe("12345678900");
  });

  it("passa senha undefined quando não informada", async () => {
    documentoFake([[]]);
    await extractPdfLines(Buffer.from("pdf"));
    expect(getDocument.mock.calls[0][0].password).toBeUndefined();
  });

  it("libera o documento no final (destroy)", async () => {
    const { destroy } = documentoFake([[{ str: "x", hasEOL: true }]]);
    await extractPdfLines(Buffer.from("pdf"));
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("propaga o erro do pdf.js (ex: senha errada)", async () => {
    getDocument.mockReturnValue({
      promise: Promise.reject(new Error("No password given")),
      destroy: vi.fn(),
    });
    await expect(extractPdfLines(Buffer.from("pdf"))).rejects.toThrow("No password given");
  });
});

describe("PdfPasswordError", () => {
  it("é um Error com nome e mensagem próprios", () => {
    const erro = new PdfPasswordError();
    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe("PdfPasswordError");
    expect(erro.message).toBe("PDF protegido por senha incorreta ou senha necessária.");
  });

  it("pode ser identificado por instanceof num catch", () => {
    try {
      throw new PdfPasswordError();
    } catch (e) {
      expect(e instanceof PdfPasswordError).toBe(true);
    }
  });
});
