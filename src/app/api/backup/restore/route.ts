import { NextResponse } from "next/server";
import { z } from "zod";
import { BACKUP_FORMAT_VERSION, backupFileSchema, restoreBackup } from "@/lib/backup";

const modeSchema = z.enum(["replace", "merge"]);

/**
 * POST /api/backup/restore?mode=replace|merge
 *
 * Restaura um arquivo de backup gerado por `GET /api/backup/export`. O corpo da
 * requisição é o arquivo JSON inteiro, exatamente como foi baixado (nenhum
 * envelope extra), o que também permite restaurar por linha de comando/curl.
 *
 * `mode` (obrigatório, sem padrão de propósito — é uma operação destrutiva
 * demais para adivinhar a intenção):
 * - `replace`: apaga tudo e insere o backup. O banco fica idêntico ao momento
 *   em que o arquivo foi gerado. É a restauração de verdade.
 * - `merge`: mantém o banco atual e insere só o que falta (casado por `id` e
 *   pelos índices únicos). Recupera dados apagados sem perder lançamentos
 *   feitos depois do backup.
 *
 * Tudo roda em uma única transação do Postgres — ou aplica inteiro, ou não
 * aplica nada (ver `restoreBackup`).
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsedMode = modeSchema.safeParse(searchParams.get("mode"));
  if (!parsedMode.success) {
    return NextResponse.json(
      { error: 'Parâmetro "mode" inválido: use "replace" (substituir tudo) ou "merge" (só adicionar o que falta).' },
      { status: 400 },
    );
  }

  // Um arquivo corrompido/truncado quebra aqui, antes de qualquer validação —
  // vale uma mensagem própria, senão o erro vira um 500 sem explicação.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "O arquivo enviado não é um JSON válido." },
      { status: 400 },
    );
  }

  // Checa a versão do formato ANTES do schema: um arquivo de uma versão futura
  // provavelmente falharia na validação por um motivo confuso, e a mensagem
  // certa é "este app é antigo para este arquivo".
  const formatVersion = (body as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof formatVersion === "number" && formatVersion > BACKUP_FORMAT_VERSION) {
    return NextResponse.json(
      {
        error: `Este backup é do formato versão ${formatVersion}, e este app entende até a versão ${BACKUP_FORMAT_VERSION}. Atualize o app antes de restaurar.`,
      },
      { status: 400 },
    );
  }

  const parsed = backupFileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "O arquivo não tem o formato de um backup deste app.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await restoreBackup(parsed.data, parsedMode.data);
    return NextResponse.json(result);
  } catch (error) {
    // Caso típico no modo `merge`: um registro do arquivo aponta para um pai
    // que não existe mais no banco atual (chave estrangeira violada). A
    // transação já desfez tudo, então é seguro só relatar.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error:
          "A restauração falhou e NADA foi alterado no banco (a operação inteira roda em uma transação). " +
          'Se você estava usando "só adicionar o que falta", tente "substituir tudo": ' +
          "provavelmente algum registro do arquivo depende de outro que não existe mais no banco atual.",
        details: message,
      },
      { status: 500 },
    );
  }
}
