import type { PoolClient } from 'pg';

/**
 * Há uma automação cuidando das respostas deste candidato? (fluxo ativo com "Aguardar resposta").
 * Nesse caso, as respostas automáticas da entrevista (etapa 7) ficam caladas, para o candidato
 * não receber duas respostas diferentes à mesma mensagem (decisão D30).
 */
export async function automacaoCuidaDasRespostas(db: PoolClient, candidatoId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM automacao_execucoes x JOIN automacao_versoes v ON v.id = x.versao_id
      WHERE x.candidato_id = $1 AND x.situacao IN ('em_andamento', 'aguardando') AND v.espera_resposta LIMIT 1`,
    [candidatoId],
  );
  return Boolean(r.rowCount);
}
