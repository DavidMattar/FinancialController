import { collectBackup } from "@/lib/backup";

/**
 * Monta o nome do arquivo com data e hora LOCAIS (não UTC), para o usuário
 * reconhecer o backup pelo horário do relógio dele:
 * `backup-financeiro-2026-08-29-1435.json`.
 */
function backupFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `backup-financeiro-${date}-${time}.json`;
}

/**
 * GET /api/backup/export
 *
 * Baixa um backup completo do banco em JSON — todas as tabelas, com os `id`
 * preservados (ver `src/lib/backup.ts` para o formato e as decisões de
 * design). A ideia é o usuário gerar um destes antes de qualquer mudança que
 * afete o banco e poder voltar atrás por `POST /api/backup/restore`, sem
 * precisar mexer no PostgreSQL.
 *
 * Responde com `Content-Disposition: attachment`, o que faz o navegador baixar
 * o arquivo em vez de exibi-lo (mesmo padrão de /api/transactions/export).
 * O JSON sai indentado de propósito: o arquivo é pequeno (uso pessoal) e assim
 * dá para inspecionar/editar à mão num editor de texto se for preciso.
 */
export async function GET() {
  const backup = await collectBackup();
  const json = JSON.stringify(backup, null, 2);

  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(new Date())}"`,
      // Backup é sempre um retrato do agora — nada de cache intermediário.
      "Cache-Control": "no-store",
    },
  });
}
