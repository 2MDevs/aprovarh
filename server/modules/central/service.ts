import type { PoolClient } from 'pg';
import { filtroUnidades } from '../../core/access.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, type Db } from '../../db/pool.ts';
import { decrypt } from '../../lib/crypto.ts';
import { notFound } from '../../lib/http.ts';
import type { UsuarioContexto } from '../../types.d.ts';

export const ETAPAS = ['candidatura', 'analise', 'entrevista', 'resultado'] as const;
export type Etapa = (typeof ETAPAS)[number];
export type SituacaoEtapa = 'concluida' | 'em_andamento' | 'aguardando' | 'nao_iniciada';

export function decifrarSeguro(v: string | null): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

/** "+5511912345678" → "(11) 91234-5678". */
export function formatarTelefone(e164: string): string {
  const d = e164.replace(/^\+55/, '');
  const ddd = d.slice(0, 2);
  const n = d.slice(2);
  return n.length === 9 ? `(${ddd}) ${n.slice(0, 5)}-${n.slice(5)}` : `(${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
}

export const mascararTelefone = (final: string) => `(••) •••••-${final}`;
export const mascararCpf = (final: string) => `•••.•••.•••-${final}`;

/**
 * Candidato visível para a pessoa (escopo de unidade conferido no servidor).
 * Quem não enxerga a unidade recebe "não encontrado" (não revela que o candidato existe).
 */
export async function candidatoVisivel(u: UsuarioContexto, id: string, db: Db = pool, travar = false) {
  const { rows } = await db.query(
    `SELECT c.*, s.nome AS status_nome, s.final AS status_final, un.nome AS unidade_nome
       FROM candidatos c JOIN status s ON s.id = c.status_id JOIN unidades un ON un.id = c.unidade_id
      WHERE c.id = $1 AND c.excluido_em IS NULL AND ($2::uuid[] IS NULL OR c.unidade_id = ANY($2))
      ${travar ? 'FOR UPDATE OF c' : ''}`,
    [id, filtroUnidades(u)],
  );
  if (!rows[0]) throw notFound('Candidato não encontrado.');
  return rows[0];
}

/**
 * Linha do tempo a partir do status (etapas antes da atual: concluídas; depois: não iniciadas).
 * Movimentação real sempre recalcula; o ajuste manual da gestora vale até a próxima movimentação.
 */
export async function recalcularLinhaDoTempo(db: PoolClient, candidatoId: string, statusId: string) {
  const { rows } = await db.query<{ etapa_portal: Etapa; situacao_portal: SituacaoEtapa }>('SELECT etapa_portal, situacao_portal FROM status WHERE id = $1', [statusId]);
  const s = rows[0];
  const pos = ETAPAS.indexOf(s.etapa_portal);
  for (const [i, etapa] of ETAPAS.entries()) {
    const situacao: SituacaoEtapa = etapa === 'candidatura' ? 'concluida' : i === pos ? s.situacao_portal : i < pos ? 'concluida' : 'nao_iniciada';
    await db.query(
      `INSERT INTO etapas_candidato (candidato_id, etapa, situacao, origem) VALUES ($1, $2, $3, 'automatica')
       ON CONFLICT (candidato_id, etapa) DO UPDATE SET situacao = EXCLUDED.situacao, origem = 'automatica', atualizado_por = NULL, atualizado_em = now()`,
      [candidatoId, etapa, situacao],
    );
  }
}

/** Avisa as telas abertas (só depois do COMMIT) que o candidato mudou. */
export async function avisarMudanca(db: PoolClient, candidatoId: string, unidadeId: string) {
  await db.query('UPDATE candidatos SET ultima_interacao_em = now(), atualizado_em = now() WHERE id = $1', [candidatoId]);
  await publicar(db, { tipo: 'candidato.atualizado', candidatoId, unidadeId });
}

export async function registrarEvento(db: PoolClient, tipo: string, candidatoId: string, dados: Record<string, unknown>) {
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', [tipo, candidatoId, JSON.stringify(dados)]);
}
