import { describe, expect, it, vi } from "vitest";
import {
  describeRequest,
  formatErrorLogLine,
  formatLogLine,
  isWriteMethod,
  localDayOf,
  pathOf,
  resourceOf,
  type LogEvent,
} from "@/lib/logEvents";

/** Um evento mínimo. O fuso dos testes é fixo em America/Sao_Paulo (vitest.config.mts). */
function evento(over: Partial<LogEvent> = {}): LogEvent {
  return {
    at: "2026-08-31T18:05:02.000Z",
    tab: "transacoes",
    level: "info",
    action: "gravou",
    detail: "criou transação",
    ...over,
  };
}

describe("localDayOf", () => {
  it("usa a data LOCAL, não a UTC", () => {
    // 31/08 às 23:30 em Brasília é 01/09 em UTC. A pasta do log tem que ser a
    // do dia que o usuário reconhece, senão a movimentação da noite aparece no
    // arquivo do dia seguinte.
    expect(localDayOf(new Date("2026-09-01T02:30:00.000Z"))).toBe("2026-08-31");
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(localDayOf(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("formatLogLine", () => {
  it("monta a linha com data local, nível, ação, aba e detalhe", () => {
    const linha = formatLogLine(evento());

    expect(linha).toContain("2026-08-31 15:05:02.000-03:00");
    expect(linha).toContain("INFO");
    expect(linha).toContain("gravou");
    expect(linha).toContain("transacoes");
    expect(linha).toContain("criou transação");
  });

  it("escreve o deslocamento de fuso na linha", () => {
    // Sem isso o arquivo fica ambíguo se um dia for lido em outra máquina.
    expect(formatLogLine(evento())).toContain("-03:00");
  });

  it("escreve deslocamento positivo num fuso a leste de Greenwich", () => {
    // O fuso da suite e fixo em America/Sao_Paulo (-03:00), entao o sinal "+"
    // so aparece forcando outro fuso. Importa porque o arquivo de log pode ser
    // lido em outra maquina, e um deslocamento com sinal errado o tornaria
    // pior do que sem deslocamento nenhum.
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-120);

    expect(formatLogLine(evento())).toContain("+02:00");

    spy.mockRestore();
  });

  it("marca erro como ERRO", () => {
    expect(formatLogLine(evento({ level: "error" }))).toContain("ERRO");
  });

  it("acrescenta o detalhe técnico quando existe, e omite quando não", () => {
    expect(formatLogLine(evento({ technical: "HTTP 400" }))).toContain("HTTP 400");
    expect(formatLogLine(evento()).endsWith("criou transação")).toBe(true);
  });

  it("não tem quebra de linha (quem grava acrescenta uma)", () => {
    expect(formatLogLine(evento({ detail: "algo" }))).not.toContain("\n");
  });

  it("alinha as colunas para o arquivo ser legível", () => {
    const curto = formatLogLine(evento({ action: "erro", level: "error" }));
    const longo = formatLogLine(evento({ action: "navegou" }));
    const colunaDaAba = (l: string) => l.indexOf("transacoes");
    expect(colunaDaAba(curto)).toBe(colunaDaAba(longo));
  });
});

describe("formatErrorLogLine", () => {
  it("põe a aba na frente, porque o arquivo junta todas", () => {
    const linha = formatErrorLogLine(evento({ level: "error", tab: "investimentos" }));

    expect(linha).toContain("[investimentos]");
    expect(linha.indexOf("[investimentos]")).toBeLessThan(linha.indexOf("criou transação"));
  });

  it("mantém data local e detalhe técnico", () => {
    const linha = formatErrorLogLine(evento({ level: "error", technical: "HTTP 500" }));
    expect(linha).toContain("2026-08-31 15:05:02.000-03:00");
    expect(linha).toContain("HTTP 500");
  });

  it("omite o técnico quando não há", () => {
    expect(formatErrorLogLine(evento({ level: "error" })).endsWith("criou transação")).toBe(true);
  });
});

describe("pathOf", () => {
  it("tira a querystring de um caminho relativo", () => {
    expect(pathOf("/api/transactions?from=2026-08-01")).toBe("/api/transactions");
  });

  it("aceita URL absoluta", () => {
    expect(pathOf("http://localhost:3000/api/categories")).toBe("/api/categories");
  });

  it("devolve o texto original quando não é uma URL que dá para analisar", () => {
    // Host inválido faz o construtor de URL lançar mesmo havendo base. O log
    // não pode ser a causa de uma exceção, então o fallback é o texto cru.
    expect(pathOf("http://[")).toBe("http://[");
  });
});

describe("resourceOf", () => {
  it("dá nome em português a cada rota da API", () => {
    expect(resourceOf("/api/transactions")).toBe("transação");
    expect(resourceOf("/api/transactions/abc")).toBe("transação");
    expect(resourceOf("/api/family-transactions/abc")).toBe("transação da família");
    expect(resourceOf("/api/categories")).toBe("categoria");
    expect(resourceOf("/api/investments")).toBe("investimento");
    expect(resourceOf("/api/backup/export")).toBe("backup do banco");
  });

  it("a rota mais específica ganha da mais geral", () => {
    // Sem a ordem certa, /api/transactions/x/items seria só "transação".
    expect(resourceOf("/api/transactions/abc/items")).toBe("sub-item de transação");
    expect(resourceOf("/api/transactions/abc/items/def")).toBe("sub-item de transação");
    expect(resourceOf("/api/transactions/abc/move-to-family")).toBe(
      "transação movida para a família",
    );
    expect(resourceOf("/api/investments/abc/purchases/def")).toBe("compra de investimento");
    expect(resourceOf("/api/investments/prices")).toBe("cotação de investimentos");
    expect(resourceOf("/api/seasonal-rentals/preview")).toBe("prévia de aluguel");
    expect(resourceOf("/api/rental-settlements/preview")).toBe("prévia de repasse");
  });

  it("rota sem nome cadastrado cai no próprio caminho, em vez de sumir", () => {
    expect(resourceOf("/api/coisa-nova")).toBe("/api/coisa-nova");
  });

  it("toda rota de API do app tem nome próprio", () => {
    // Guarda contra rota nova entrar e o log dela ficar cru.
    const rotas = [
      "/api/transactions",
      "/api/transactions/x/items",
      "/api/transactions/x/move-to-family",
      "/api/transactions/export",
      "/api/transactions/metrics",
      "/api/family-transactions",
      "/api/categories",
      "/api/credit-cards",
      "/api/invoices/parse",
      "/api/invoices/confirm",
      "/api/receipts/parse",
      "/api/receipts/confirm",
      "/api/investments",
      "/api/investments/prices",
      "/api/investments/x/purchases/y",
      "/api/views",
      "/api/budget/summary",
      "/api/seasonal-rentals",
      "/api/seasonal-rentals/preview",
      "/api/rental-settlements",
      "/api/rental-settlements/preview",
      "/api/backup/export",
      "/api/backup/restore",
      "/api/logs",
    ];
    for (const rota of rotas) {
      expect(resourceOf(rota), rota).not.toBe(rota);
    }
  });
});

describe("describeRequest", () => {
  it("junta verbo do método com nome do recurso", () => {
    expect(describeRequest("POST", "/api/transactions")).toBe("criou transação");
    expect(describeRequest("PATCH", "/api/categories/abc")).toBe("atualizou categoria");
    expect(describeRequest("PUT", "/api/seasonal-rentals/abc")).toBe("atualizou aluguel de temporada");
    expect(describeRequest("DELETE", "/api/investments/a/purchases/b")).toBe(
      "apagou compra de investimento",
    );
    expect(describeRequest("GET", "/api/budget/summary")).toBe("consultou orçamento do mês");
  });

  it("aceita método em minúsculo", () => {
    expect(describeRequest("post", "/api/transactions")).toBe("criou transação");
  });

  it("método fora do previsto ainda produz descrição", () => {
    expect(describeRequest("HEAD", "/api/transactions")).toBe("head transação");
  });
});

describe("isWriteMethod", () => {
  it("é verdadeiro só para os métodos que mudam dado", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE", "post", "delete"]) {
      expect(isWriteMethod(m), m).toBe(true);
    }
    for (const m of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(isWriteMethod(m), m).toBe(false);
    }
  });
});
