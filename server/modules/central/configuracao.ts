import { Router } from 'express';
import { z } from 'zod';
import { auditarReq } from '../../core/audit.ts';
import { pool, transaction } from '../../db/pool.ts';
import { badRequest, conflict, h, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';

/**
 * Status e tags (funcionalidades independentes).
 * Leitura: quem vê candidatos. Criar, editar e excluir: `status.configurar`.
 * Os 5 status iniciais podem ser renomeados e recoloridos, mas não excluídos.
 */
export const configCentralRouter = Router();
configCentralRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'));

const uuid = z.string().uuid();
const cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.');
const duplicado = (err: unknown) => (err as { code?: string }).code === '23505';

// ── Status ─────────────────────────────────────────────────────────────────
configCentralRouter.get('/status', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.nome, s.cor, s.ordem, s.final, s.chave_sistema, s.etapa_portal, s.situacao_portal,
            (SELECT count(*)::int FROM candidatos c WHERE c.status_id = s.id AND c.excluido_em IS NULL) AS candidatos
       FROM status s WHERE s.ativo ORDER BY s.ordem, s.nome`,
  );
  res.json(rows.map((s) => ({
    id: s.id, nome: s.nome, cor: s.cor, ordem: s.ordem, final: s.final, sistema: Boolean(s.chave_sistema), chave: s.chave_sistema,
    etapaPortal: s.etapa_portal, situacaoPortal: s.situacao_portal, candidatos: s.candidatos,
  })));
}));

const dadosStatus = z.object({
  nome: z.string().trim().min(2).max(60),
  cor,
  ordem: z.number().int().min(0).max(999),
  final: z.boolean(),
  etapaPortal: z.enum(['candidatura', 'analise', 'entrevista', 'resultado']),
  situacaoPortal: z.enum(['concluida', 'em_andamento', 'aguardando', 'nao_iniciada']),
});

configCentralRouter.post('/status', exigirPermissao('status.configurar'), h(async (req, res) => {
  const b = parse(dadosStatus, req.body);
  try {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO status (nome, cor, ordem, final, etapa_portal, situacao_portal) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.nome, b.cor, b.ordem, b.final, b.etapaPortal, b.situacaoPortal],
    );
    await auditarReq(req, { acao: 'status.criado', resultado: 'sucesso', item: { tipo: 'status', id: r.rows[0].id, nome: b.nome }, detalhes: b });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    if (duplicado(err)) throw conflict('Já existe um status com este nome.');
    throw err;
  }
}));

configCentralRouter.put('/status/:id', exigirPermissao('status.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(dadosStatus, req.body);
  const atual = await pool.query<{ chave_sistema: string | null; final: boolean }>('SELECT chave_sistema, final FROM status WHERE id = $1 AND ativo', [id]);
  if (!atual.rowCount) throw notFound('Status não encontrado.');
  // Os status do sistema mantêm se são finais ou não (o cadastro depende de "Novo candidato" não ser final).
  const final = atual.rows[0].chave_sistema ? atual.rows[0].final : b.final;
  try {
    await pool.query(
      `UPDATE status SET nome = $2, cor = $3, ordem = $4, final = $5, etapa_portal = $6, situacao_portal = $7, atualizado_em = now() WHERE id = $1`,
      [id, b.nome, b.cor, b.ordem, final, b.etapaPortal, b.situacaoPortal],
    );
  } catch (err) {
    if (duplicado(err)) throw conflict('Já existe um status com este nome.');
    throw err;
  }
  await auditarReq(req, { acao: 'status.alterado', resultado: 'sucesso', item: { tipo: 'status', id, nome: b.nome }, detalhes: { ...b, final } });
  res.json({ ok: true });
}));

configCentralRouter.delete('/status/:id', exigirPermissao('status.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await pool.query<{ nome: string; chave_sistema: string | null }>('SELECT nome, chave_sistema FROM status WHERE id = $1 AND ativo', [id]);
  if (!rows[0]) throw notFound('Status não encontrado.');
  if (rows[0].chave_sistema) throw badRequest('Os status iniciais do sistema não podem ser excluídos. Você pode renomear.');
  const emUso = await pool.query('SELECT 1 FROM candidatos WHERE status_id = $1 AND excluido_em IS NULL LIMIT 1', [id]);
  if (emUso.rowCount) throw conflict('Há candidatos neste status. Mude o status deles antes de excluir.');
  await pool.query('UPDATE status SET ativo = false, atualizado_em = now() WHERE id = $1', [id]);
  await auditarReq(req, { acao: 'status.excluido', resultado: 'sucesso', item: { tipo: 'status', id, nome: rows[0].nome } });
  res.json({ ok: true });
}));

// ── Tags ───────────────────────────────────────────────────────────────────
configCentralRouter.get('/tags', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.nome, t.cor, (SELECT count(*)::int FROM candidato_tags ct JOIN candidatos c ON c.id = ct.candidato_id
                                   WHERE ct.tag_id = t.id AND c.excluido_em IS NULL) AS candidatos
       FROM tags t WHERE t.ativa ORDER BY t.nome`,
  );
  res.json(rows);
}));

const dadosTag = z.object({ nome: z.string().trim().min(1).max(60), cor });

configCentralRouter.post('/tags', exigirPermissao('status.configurar'), h(async (req, res) => {
  const b = parse(dadosTag, req.body);
  try {
    const r = await pool.query<{ id: string }>('INSERT INTO tags (nome, cor, criada_por) VALUES ($1, $2, $3) RETURNING id', [b.nome, b.cor, req.usuario!.id]);
    await auditarReq(req, { acao: 'tag.criada', resultado: 'sucesso', item: { tipo: 'tag', id: r.rows[0].id, nome: b.nome } });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    if (duplicado(err)) throw conflict('Já existe uma tag com este nome.');
    throw err;
  }
}));

configCentralRouter.put('/tags/:id', exigirPermissao('status.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(dadosTag, req.body);
  try {
    const r = await pool.query('UPDATE tags SET nome = $2, cor = $3, atualizado_em = now() WHERE id = $1 AND ativa', [id, b.nome, b.cor]);
    if (!r.rowCount) throw notFound('Tag não encontrada.');
  } catch (err) {
    if (duplicado(err)) throw conflict('Já existe uma tag com este nome.');
    throw err;
  }
  await auditarReq(req, { acao: 'tag.alterada', resultado: 'sucesso', item: { tipo: 'tag', id, nome: b.nome } });
  res.json({ ok: true });
}));

/** Excluir a tag tira ela de todos os candidatos (o histórico continua). */
configCentralRouter.delete('/tags/:id', exigirPermissao('status.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const nome = await transaction(async (db) => {
    const r = await db.query<{ nome: string }>('UPDATE tags SET ativa = false, atualizado_em = now() WHERE id = $1 AND ativa RETURNING nome', [id]);
    if (!r.rowCount) throw notFound('Tag não encontrada.');
    const removidos = await db.query<{ candidato_id: string }>('DELETE FROM candidato_tags WHERE tag_id = $1 RETURNING candidato_id', [id]);
    for (const c of removidos.rows) {
      await db.query(
        `INSERT INTO tags_historico (candidato_id, tag_id, acao, autor_tipo, autor_usuario_id, autor_nome) VALUES ($1, $2, 'removida', 'usuario', $3, $4)`,
        [c.candidato_id, id, req.usuario!.id, `${req.usuario!.nome} (tag excluída)`],
      );
    }
    await auditarReq(req, { acao: 'tag.excluida', resultado: 'sucesso', item: { tipo: 'tag', id, nome: r.rows[0].nome }, detalhes: { candidatos: removidos.rowCount } }, db);
    return r.rows[0].nome;
  });
  res.json({ ok: true, nome });
}));
