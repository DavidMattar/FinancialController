import { describe, expect, it } from "vitest";
import {
  explainFailedRequest,
  explainThrownError,
  fieldNamesFromZodError,
} from "@/lib/errorExplain";

/** Requisição falhada mínima. */
function req(over: Record<string, unknown> = {}) {
  return { method: "POST", url: "/api/transactions", ...over } as Parameters<
    typeof explainFailedRequest
  >[0];
}

describe("fieldNamesFromZodError", () => {
  it("extrai os campos de um erro achatado do zod", () => {
    // É o formato que TODAS as rotas deste app devolvem em 400
    // (`parsed.error.flatten()`).
    const body = { error: { formErrors: [], fieldErrors: { amount: ["esperado number"], date: ["obrigatório"] } } };
    expect(fieldNamesFromZodError(body)).toEqual(["amount", "date"]);
  });

  it("devolve lista vazia para qualquer corpo fora desse formato", () => {
    for (const body of [
      undefined,
      null,
      "texto",
      42,
      {},
      { error: null },
      { error: "mensagem" },
      { error: {} },
      { error: { fieldErrors: null } },
      { error: { fieldErrors: "nao é objeto" } },
    ]) {
      expect(fieldNamesFromZodError(body)).toEqual([]);
    }
  });
});

describe("explainFailedRequest", () => {
  it("sem status = não houve resposta, e a explicação fala do servidor parado", () => {
    const e = explainFailedRequest(req({ networkMessage: "Failed to fetch" }));

    expect(e.title).toBe("Sem resposta do servidor");
    expect(e.why).toContain("npm run dev");
    expect(e.technical).toContain("Failed to fetch");
  });

  it("400 nomeia os campos recusados", () => {
    const e = explainFailedRequest(
      req({ status: 400, body: { error: { fieldErrors: { amount: ["x"] } } } }),
    );

    expect(e.title).toBe("Dados recusados pelo servidor");
    expect(e.what).toContain("amount");
    expect(e.hint).toContain("Nada foi gravado");
  });

  it("400 sem detalhe de campo ainda explica que nada foi gravado", () => {
    const e = explainFailedRequest(req({ status: 400, body: { error: "sei lá" } }));

    expect(e.what).toContain("recusou os dados");
    expect(e.what).not.toContain("undefined");
  });

  it("404 explica que o registro sumiu, talvez em outra aba", () => {
    const e = explainFailedRequest(req({ status: 404, method: "DELETE" }));

    expect(e.title).toBe("Registro não encontrado");
    expect(e.why).toContain("outra aba");
  });

  it("409 fala de restrição de unicidade", () => {
    const e = explainFailedRequest(req({ status: 409 }));

    expect(e.title).toContain("Conflito");
    expect(e.why).toContain("unicidade");
  });

  it("500 aponta o banco e o terminal do dev", () => {
    const e = explainFailedRequest(req({ status: 500 }));

    expect(e.title).toBe("Erro no servidor");
    expect(e.why).toContain("schema.prisma");
    expect(e.hint).toContain("npm run dev");
  });

  it("503 também cai no caso de erro de servidor", () => {
    expect(explainFailedRequest(req({ status: 503 })).title).toBe("Erro no servidor");
  });

  it("status inesperado ainda produz uma explicação, com o número dentro", () => {
    const e = explainFailedRequest(req({ status: 418 }));

    expect(e.title).toContain("418");
    expect(e.what).toContain("não sabe tratar");
  });

  it("o detalhe técnico junta método, URL, status e corpo", () => {
    const e = explainFailedRequest(req({ status: 400, body: { error: "x" } }));

    expect(e.technical).toContain("POST /api/transactions");
    expect(e.technical).toContain("HTTP 400");
    expect(e.technical).toContain('{"error":"x"}');
  });

  it("corpo em texto puro entra no detalhe sem virar JSON", () => {
    const e = explainFailedRequest(req({ status: 500, body: "Internal Server Error" }));
    expect(e.technical).toContain("Internal Server Error");
  });

  it("corpo vazio ou nulo não deixa lixo no detalhe", () => {
    for (const body of [undefined, null, ""]) {
      const e = explainFailedRequest(req({ status: 500, body }));
      expect(e.technical).toBe("POST /api/transactions · HTTP 500");
    }
  });

  it("toda explicação tem título, o que e por que preenchidos", () => {
    // O pop-up mostra os três campos; nenhum pode sair vazio.
    for (const status of [undefined, 400, 404, 409, 418, 500]) {
      const e = explainFailedRequest(req({ status }));
      expect(e.title.length, String(status)).toBeGreaterThan(0);
      expect(e.what.length, String(status)).toBeGreaterThan(0);
      expect(e.why.length, String(status)).toBeGreaterThan(0);
    }
  });
});

describe("explainThrownError", () => {
  it("usa a mensagem do Error e guarda a stack no detalhe técnico", () => {
    const erro = new Error("undefined não tem propriedade foo");
    const e = explainThrownError(erro, "erro de JavaScript");

    expect(e.title).toBe("Erro inesperado na tela");
    expect(e.why).toContain("undefined não tem propriedade foo");
    expect(e.why).toContain("erro de JavaScript");
    expect(e.technical).toContain("Error");
  });

  it("aceita valor lançado que não é Error", () => {
    // `throw "texto"` e promessa rejeitada com objeto qualquer acontecem.
    const e = explainThrownError("quebrou", "promessa rejeitada sem tratamento");

    expect(e.why).toContain("quebrou");
    expect(e.technical).toBe("quebrou");
  });

  it("Error sem stack cai na mensagem", () => {
    const erro = new Error("sem stack");
    erro.stack = undefined;
    expect(explainThrownError(erro, "origem").technical).toBe("sem stack");
  });

  it("avisa que o erro foi gravado no log", () => {
    // É o que diferencia "a tela travou" de "a tela travou e ninguém soube".
    expect(explainThrownError(new Error("x"), "origem").hint).toContain("log de erros");
  });
});
