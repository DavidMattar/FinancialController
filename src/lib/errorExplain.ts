/**
 * Tradução de falha técnica para explicação em português — "o que aconteceu" e
 * "por que aconteceu".
 *
 * Por que existe: o app passou a mostrar TODO erro num pop-up, e um pop-up que
 * diz "HTTP 400" ou "Failed to fetch" não é melhor que erro nenhum. Cada falha
 * possível ganha aqui um título curto, uma frase do que aconteceu, uma do
 * motivo provável, e — quando existe — o que fazer a respeito.
 *
 * É pura de propósito (não toca DOM nem rede): a mesma explicação alimenta o
 * pop-up e a linha do arquivo de log, então as duas nunca contam versões
 * diferentes da mesma falha.
 */

/** Uma falha já explicada, pronta para exibir e para gravar no log. */
export interface ExplainedError {
  /** Título curto do pop-up (ex: "Valor recusado"). */
  title: string;
  /** O que aconteceu, na perspectiva do usuário. */
  what: string;
  /** Por que aconteceu (causa provável). */
  why: string;
  /** O que fazer. Vazio quando não há ação óbvia. */
  hint?: string;
  /**
   * Detalhe técnico (status, corpo do erro, stack). Vai para o log sempre, e
   * para o pop-up dentro de um bloco recolhido — quem está usando o app não
   * precisa ler, quem está depurando precisa.
   */
  technical?: string;
}

/** O que se sabe de uma requisição que falhou. */
export interface FailedRequest {
  method: string;
  url: string;
  /** Ausente quando a requisição não chegou a receber resposta (rede caiu). */
  status?: number;
  /** Corpo da resposta, se deu para ler. */
  body?: unknown;
  /** Mensagem da exceção, quando o `fetch` rejeitou. */
  networkMessage?: string;
}

/**
 * Extrai os nomes de campo de um erro do zod já "achatado"
 * (`error.flatten()`), que é o formato que todas as rotas deste app devolvem
 * em 400. Serve para o pop-up poder dizer QUAL campo o servidor recusou em vez
 * de só "dados inválidos".
 */
export function fieldNamesFromZodError(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return [];
  const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return [];
  return Object.keys(fieldErrors as Record<string, unknown>);
}

/** Texto técnico compacto de uma requisição falhada, para o log e o bloco de detalhe. */
function technicalOf(request: FailedRequest): string {
  const partes = [`${request.method} ${request.url}`];
  if (request.status !== undefined) partes.push(`HTTP ${request.status}`);
  if (request.networkMessage) partes.push(request.networkMessage);
  if (request.body !== undefined && request.body !== null && request.body !== "") {
    partes.push(typeof request.body === "string" ? request.body : JSON.stringify(request.body));
  }
  return partes.join(" · ");
}

/**
 * Explica a falha de uma requisição à API.
 *
 * A ordem dos casos importa: "não houve resposta" vem antes de qualquer status,
 * porque sem status não há o que classificar.
 */
export function explainFailedRequest(request: FailedRequest): ExplainedError {
  const technical = technicalOf(request);

  if (request.status === undefined) {
    return {
      title: "Sem resposta do servidor",
      what: "O navegador não conseguiu falar com o servidor do app, então a ação não foi feita.",
      why: "O processo do `npm run dev` provavelmente parou, está reiniciando, ou a porta 3000 foi tomada por outro processo.",
      hint: "Confira o terminal onde o `npm run dev` está rodando e recarregue a página.",
      technical,
    };
  }

  if (request.status === 400) {
    const campos = fieldNamesFromZodError(request.body);
    return {
      title: "Dados recusados pelo servidor",
      what:
        campos.length > 0
          ? `O servidor recusou o que foi enviado nestes campos: ${campos.join(", ")}.`
          : "O servidor recusou os dados enviados e não gravou nada.",
      why: "Algum valor não passou na validação — em geral um número que não deu para ler, um campo obrigatório em branco, ou uma data fora do formato.",
      hint: "Revise os campos apontados e envie de novo. Nada foi gravado.",
      technical,
    };
  }

  if (request.status === 404) {
    return {
      title: "Registro não encontrado",
      what: "O registro que a ação tentou alterar não existe mais.",
      why: "Ele provavelmente foi apagado depois que esta tela carregou — inclusive por outra aba do navegador aberta no mesmo app.",
      hint: "Recarregue a página para ver o estado atual.",
      technical,
    };
  }

  if (request.status === 409) {
    return {
      title: "Conflito com um registro que já existe",
      what: "O servidor não gravou porque já existe um registro com os mesmos dados únicos.",
      why: "Alguma restrição de unicidade foi violada (nome de categoria repetido, cartão repetido, fatura do mesmo mês).",
      hint: "Edite o registro que já existe em vez de criar outro.",
      technical,
    };
  }

  if (request.status >= 500) {
    return {
      title: "Erro no servidor",
      what: "O servidor recebeu a ação mas quebrou no meio dela.",
      why: "Normalmente é o banco: PostgreSQL fora do ar, schema fora de sincronia com o Prisma Client (depois de mexer no `schema.prisma` é preciso reiniciar o `npm run dev` por completo), ou um valor fora do que a coluna aceita.",
      hint: "Veja o terminal do `npm run dev`: o erro completo aparece lá. O log de erros do dia também registra esta linha.",
      technical,
    };
  }

  return {
    title: `A ação não foi aceita (HTTP ${request.status})`,
    what: "O servidor respondeu com um código que esta tela não sabe tratar, e a ação não foi concluída.",
    why: "É uma resposta fora dos casos previstos — pode ser uma rota que mudou de contrato.",
    technical,
  };
}

/**
 * Explica uma exceção que estourou no navegador (erro de JavaScript ou promessa
 * rejeitada sem tratamento), capturada pelos handlers globais.
 *
 * Estes não têm causa conhecida — o valor da explicação aqui é dizer ao usuário
 * que a tela pode estar num estado inconsistente e que o erro FOI registrado,
 * em vez de deixar a interface travada em silêncio.
 */
export function explainThrownError(error: unknown, origin: string): ExplainedError {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : undefined;
  return {
    title: "Erro inesperado na tela",
    what: "Uma parte da tela quebrou no meio da execução. O que estava sendo feito pode não ter sido concluído.",
    why: `Falha não prevista em ${origin}: ${message}`,
    hint: "Recarregue a página. O erro completo foi gravado no log de erros do dia.",
    technical: stack ?? message,
  };
}
