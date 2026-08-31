import { NextResponse } from "next/server";
import { z } from "zod";
import { appendLogEvents } from "@/lib/logFiles";

/**
 * Um evento de log como o navegador manda.
 *
 * `at` chega do cliente (e não é gerado aqui) de propósito: o instante que
 * interessa é o do acontecimento, e o envio é em lote, com atraso. Um
 * `new Date()` aqui registraria a hora do POST, não a da movimentação.
 */
const eventSchema = z.object({
  at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: "data/hora inválida" }),
  tab: z.string().min(1).max(64),
  level: z.enum(["info", "error"]),
  action: z.string().min(1).max(32),
  detail: z.string().min(1).max(500),
  technical: z.string().max(4000).optional(),
});

const bodySchema = z.object({
  // Um teto por requisição para um cliente com defeito não conseguir encher o
  // disco numa chamada só; o navegador envia lotes bem menores que isso.
  events: z.array(eventSchema).min(1).max(200),
});

/**
 * POST /api/logs
 * Grava movimentações e erros nos arquivos de log do dia (ver `src/lib/logFiles.ts`
 * para a estrutura de pastas e o motivo de erro entrar em dois arquivos).
 *
 * Só o servidor pode escrever em disco, então o navegador precisa desta rota:
 * é ela que transforma "o usuário criou uma transação" em uma linha em
 * `logs/AAAA-MM-DD/transacoes.log`.
 *
 * **Esta rota nunca deve virar um pop-up de erro na tela.** Se a gravação
 * falhar, o interceptador do cliente é instruído a só reportar no console — um
 * erro de log que abrisse pop-up geraria um novo evento de log, que falharia de
 * novo, num laço infinito. Ver `src/components/ActivityLogger.tsx`.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "corpo não é JSON válido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const written = await appendLogEvents(parsed.data.events);
    return NextResponse.json({ ok: true, written });
  } catch (error) {
    // Disco cheio, permissão negada, pasta somente-leitura. Responder 500 aqui
    // é o certo (o cliente registra no console), mas a resposta não pode
    // carregar o caminho absoluto do disco para uma tela.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `falha ao gravar o log: ${message}` }, { status: 500 });
  }
}
