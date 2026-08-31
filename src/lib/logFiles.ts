/**
 * Gravação dos arquivos de log em disco.
 *
 * Estrutura criada automaticamente na raiz do projeto:
 *
 * ```
 * logs/
 *   2026-08-31/
 *     transacoes.log        ← toda movimentação da aba Transações, inclusive erros
 *     investimentos.log
 *     dashboard.log
 *     erros.log             ← o log PARALELO: só erros, de todas as abas
 *   2026-09-01/
 *     ...
 * ```
 *
 * Duas decisões centrais:
 *
 * 1. **Um erro é gravado nos DOIS arquivos.** No log da aba, para a cronologia
 *    daquela aba ficar completa (dá para ver o que o usuário fez imediatamente
 *    antes de quebrar); e no `erros.log`, para "houve erro hoje?" ser uma
 *    pergunta respondida abrindo um arquivo só. Era o pedido de "nada fica sem
 *    registro": nenhum dos dois arquivos, lido isolado, esconde um erro.
 * 2. **A pasta é escolhida pela data LOCAL.** É o dia que o usuário reconhece.
 *    Ver a nota de fuso em `logEvents.ts`.
 *
 * `logs/` está no `.gitignore`: é dado de execução da máquina, não código.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { formatErrorLogLine, formatLogLine, localDayOf, type LogEvent } from "./logEvents";
import { isValidTabSlug, UNKNOWN_TAB_SLUG } from "./appTabs";

/** Nome da pasta de logs na raiz do projeto. */
export const LOG_DIR_NAME = "logs";

/** Nome do arquivo que junta os erros de todas as abas do dia. */
export const ERROR_LOG_NAME = "erros.log";

/** Raiz da pasta de logs. `process.cwd()` é a raiz do projeto quando o Next roda. */
export function logRoot(): string {
  return path.join(process.cwd(), LOG_DIR_NAME);
}

/** Pasta do dia (`logs/2026-08-31`). */
export function dayDir(date: Date): string {
  return path.join(logRoot(), localDayOf(date));
}

/**
 * Slug seguro para nome de arquivo. Um slug fora do formato esperado não é
 * motivo para descartar o evento — vai para o arquivo de rota desconhecida,
 * porque o requisito é que nada fique sem registro.
 */
export function safeSlug(slug: string): string {
  return isValidTabSlug(slug) ? slug : UNKNOWN_TAB_SLUG;
}

/**
 * Grava uma lista de eventos nos arquivos do dia.
 *
 * Os eventos vêm em lote (o navegador acumula e envia junto) e podem ser de
 * abas diferentes, então são agrupados por arquivo para fazer um `appendFile`
 * por arquivo em vez de um por linha.
 *
 * @returns Quantas linhas foram gravadas em cada arquivo, para a rota poder
 *   responder o que fez (e para o teste poder verificar sem ler disco).
 */
export async function appendLogEvents(events: LogEvent[]): Promise<Record<string, number>> {
  const written: Record<string, number> = {};
  if (events.length === 0) return written;

  // Agrupa por arquivo destino: "<dia>/<arquivo>" -> linhas.
  const porArquivo = new Map<string, { dir: string; file: string; lines: string[] }>();

  function acrescentar(dir: string, file: string, line: string) {
    const chave = path.join(dir, file);
    const atual = porArquivo.get(chave);
    if (atual) {
      atual.lines.push(line);
      return;
    }
    porArquivo.set(chave, { dir, file, lines: [line] });
  }

  for (const event of events) {
    const at = new Date(event.at);
    const dir = dayDir(at);
    acrescentar(dir, `${safeSlug(event.tab)}.log`, formatLogLine(event));
    // Erro entra também no log paralelo (ver nota 1 no topo do arquivo).
    if (event.level === "error") {
      acrescentar(dir, ERROR_LOG_NAME, formatErrorLogLine(event));
    }
  }

  for (const { dir, file, lines } of porArquivo.values()) {
    // `recursive: true` cria `logs/` e a pasta do dia de uma vez, e não
    // reclama se já existirem — é o que torna a pasta "criada automaticamente".
    await mkdir(dir, { recursive: true });
    const destino = path.join(dir, file);
    await appendFile(destino, `${lines.join("\n")}\n`, "utf8");
    written[path.join(path.basename(dir), file)] = lines.length;
  }

  return written;
}
