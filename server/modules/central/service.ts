import type { PoolClient } from 'pg';
import { filtroUnidades } from '../../core/access.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, type Db } from '../../db/pool.ts';
import { decrypt } from '../../lib/crypto.ts';
import { badRequest, notFound } from '../../lib/http.ts';
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
    `SELECT c.*, s.nome AS status_nome, s.cor AS status_cor, s.final AS status_final, un.nome AS unidade_nome
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

export interface AutorMudanca { tipo: 'usuario' | 'automacao' | 'sistema'; id: string | null; nome: string }

/**
 * Muda o status (histórico, linha do tempo, evento e aviso em tempo real). Usado pela tela e pelas automações.
 * Devolve null se já estava nesse status. Quem chama registra a auditoria.
 */
export async function alterarStatusCandidato(db: PoolClient, candidatoId: string, statusId: string, autor: AutorMudanca, motivo?: string | null) {
  const c = await db.query<{ status_id: string; status_nome: string; unidade_id: string; codigo: string }>(
    `SELECT c.status_id, s.nome AS status_nome, c.unidade_id, c.codigo FROM candidatos c JOIN status s ON s.id = c.status_id WHERE c.id = $1 FOR UPDATE OF c`,
    [candidatoId],
  );
  const atual = c.rows[0];
  if (!atual) throw notFound('Candidato não encontrado.');
  if (atual.status_id === statusId) return null;
  const s = await db.query<{ nome: string }>('SELECT nome FROM status WHERE id = $1 AND ativo', [statusId]);
  if (!s.rowCount) throw badRequest('Status não encontrado.');
  await db.query('UPDATE candidatos SET status_id = $2 WHERE id = $1', [candidatoId, statusId]);
  await db.query(
    `INSERT INTO status_historico (candidato_id, status_anterior_id, status_novo_id, autor_tipo, autor_usuario_id, autor_nome, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [candidatoId, atual.status_id, statusId, autor.tipo, autor.tipo === 'usuario' ? autor.id : null, autor.nome, motivo ?? null],
  );
  await recalcularLinhaDoTempo(db, candidatoId, statusId);
  await registrarEvento(db, 'candidato.status_alterado', candidatoId, { de: atual.status_id, para: statusId, autor });
  await avisarMudanca(db, candidatoId, atual.unidade_id);
  return { de: atual.status_nome, para: s.rows[0].nome, codigo: atual.codigo };
}

/** Coloca ou tira uma tag. Devolve null se já estava assim. Quem chama registra a auditoria. */
export async function alterarTagCandidato(db: PoolClient, candidatoId: string, tagId: string, acao: 'adicionar' | 'remover', autor: AutorMudanca) {
  const t = await db.query<{ nome: string }>('SELECT nome FROM tags WHERE id = $1 AND ativa', [tagId]);
  if (!t.rowCount) throw badRequest('Tag não encontrada.');
  const c = await db.query<{ unidade_id: string; codigo: string }>('SELECT unidade_id, codigo FROM candidatos WHERE id = $1', [candidatoId]);
  if (!c.rows[0]) throw notFound('Candidato não encontrado.');
  const r = acao === 'adicionar'
    ? await db.query('INSERT INTO candidato_tags (candidato_id, tag_id, adicionada_por) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [candidatoId, tagId, autor.tipo === 'usuario' ? autor.id : null])
    : await db.query('DELETE FROM candidato_tags WHERE candidato_id = $1 AND tag_id = $2', [candidatoId, tagId]);
  if (!r.rowCount) return null;
  await db.query(
    `INSERT INTO tags_historico (candidato_id, tag_id, acao, autor_tipo, autor_usuario_id, autor_nome) VALUES ($1, $2, $3, $4, $5, $6)`,
    [candidatoId, tagId, acao === 'adicionar' ? 'adicionada' : 'removida', autor.tipo, autor.tipo === 'usuario' ? autor.id : null, autor.nome],
  );
  await registrarEvento(db, acao === 'adicionar' ? 'candidato.tag_adicionada' : 'candidato.tag_removida', candidatoId, { tagId, autor });
  await avisarMudanca(db, candidatoId, c.rows[0].unidade_id);
  return { tag: t.rows[0].nome, codigo: c.rows[0].codigo };
}
