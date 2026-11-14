import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { isProd } from '../../config/env.ts';
import { auditar } from '../../core/audit.ts';
import { cfgNumero } from '../../core/settings.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, transaction } from '../../db/pool.ts';
import { descartarArquivos, detectarTipo, guardarArquivo, lerArquivo, type ArquivoGuardado } from '../../lib/arquivos.ts';
import { encrypt, hmac, randomToken } from '../../lib/crypto.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { badRequest, forbidden, h, HttpError, ipDe, notFound, parse, tooMany } from '../../lib/http.ts';
import { limiteAutenticacao } from '../../middleware/limits.ts';
import { decifrarSeguro, ETAPAS } from '../central/service.ts';
import { hashCodigo, normalizarCodigo } from './servico.ts';

/**
 * Portal do candidato. Totalmente separado da área interna:
 * - cookie próprio (arh_portal), que nenhuma rota interna aceita (e o cookie interno não vale aqui);
 * - toda consulta usa o candidato da SESSÃO, nunca um id enviado pelo navegador;
 * - as respostas são montadas aqui, só com o que o candidato pode ver: primeiro nome, etapas,
 *   mensagens visíveis. Nunca status interno, tags, observações ou dados de outros candidatos.
 */
export const portalRouter = Router();

export const COOKIE_PORTAL = 'arh_portal';
const MSG_INVALIDO = 'Código inválido ou expirado.';
/** Proteção contra tentativa e erro vinda de muitos IPs ao mesmo tempo. */
const MAX_FALHAS_GLOBAIS_10MIN = 300;

declare global {
  namespace Express {
    interface Request {
      portal?: { sessaoId: string; liberacaoId: string; candidatoId: string; unidadeId: string; expiraEm: Date; permiteArquivo: boolean; nome: string };
    }
  }
}

const exigirPortal: RequestHandler = h(async (req, res, next) => {
  const token = req.cookies?.[COOKIE_PORTAL];
  if (!token || typeof token !== 'string') throw new HttpError(401, 'Seu acesso terminou. Use um código novo.', 'portal_expirado');
  const { rows } = await pool.query(
    `SELECT s.id, s.liberacao_id, s.candidato_id, s.ultimo_uso_em, l.expira_em, l.situacao, l.permite_arquivo, c.unidade_id, c.nome
       FROM sessoes_portal s JOIN liberacoes_acesso l ON l.id = s.liberacao_id JOIN candidatos c ON c.id = s.candidato_id
      WHERE s.token_hash = $1 AND s.encerrada_em IS NULL AND c.excluido_em IS NULL`,
    [hmac(`sessao-portal:${token}`)],
  );
  const s = rows[0];
  // Conferido em TODA requisição: o acesso termina às 23:59:59 mesmo que a rotina do Worker atrase.
  if (!s || s.situacao !== 'ativa' || new Date(s.expira_em) <= new Date()) {
    if (s) await pool.query(`UPDATE sessoes_portal SET encerrada_em = now(), motivo_encerramento = $2 WHERE id = $1 AND encerrada_em IS NULL`, [s.id, s.situacao === 'revogada' ? 'revogada' : 'expirou']);
    res.clearCookie(COOKIE_PORTAL, { path: '/' });
    throw new HttpError(401, 'Seu acesso terminou. Use um código novo.', 'portal_expirado');
  }
  if (Date.now() - new Date(s.ultimo_uso_em).getTime() > 60_000) await pool.query('UPDATE sessoes_portal SET ultimo_uso_em = now() WHERE id = $1', [s.id]);
  req.portal = { sessaoId: s.id, liberacaoId: s.liberacao_id, candidatoId: s.candidato_id, unidadeId: s.unidade_id, expiraEm: new Date(s.expira_em), permiteArquivo: s.permite_arquivo, nome: s.nome };
  next();
});

const ator = (req: Express.Request) => ({ usuarioNome: `Candidato ${req.portal?.nome ?? ''}`.trim() });

// ── Entrar com o código ────────────────────────────────────────────────────
portalRouter.post('/entrar', limiteAutenticacao, h(async (req, res) => {
  const ip = ipDe(req);
  const dispositivo = descreverDispositivo(req.get('user-agent')).nome;
  const falhas = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM acessos_portal WHERE resultado <> 'sucesso' AND em > now() - interval '10 minutes'`);
  if (falhas.rows[0].n > MAX_FALHAS_GLOBAIS_10MIN) throw tooMany('Muitas tentativas no momento. Aguarde alguns minutos e tente de novo.');

  const codigo = normalizarCodigo(parse(z.object({ codigo: z.string().max(20) }), req.body).codigo);
  const l = codigo
    ? (await pool.query(
        `SELECT l.id, l.candidato_id, l.situacao, l.expira_em, c.nome, c.unidade_id
           FROM liberacoes_acesso l JOIN candidatos c ON c.id = l.candidato_id
          WHERE l.codigo_hash = $1 AND c.excluido_em IS NULL`,
        [hashCodigo(codigo)],
      )).rows[0]
    : null;

  const valido = l && l.situacao === 'ativa' && new Date(l.expira_em) > new Date();
  if (!valido) {
    const resultado = !l ? 'codigo_invalido' : l.situacao === 'revogada' ? 'revogado' : 'expirado';
    await pool.query('INSERT INTO acessos_portal (candidato_id, liberacao_id, resultado, ip, dispositivo) VALUES ($1, $2, $3, $4, $5)', [l?.candidato_id ?? null, l?.id ?? null, resultado, ip, dispositivo]);
    await auditar({ acao: 'portal.entrada', resultado: 'negado', item: l ? { tipo: 'candidato', id: l.candidato_id } : undefined, detalhes: { motivo: resultado }, ator: { usuarioNome: 'Portal do candidato' }, ip, dispositivo });
    throw new HttpError(401, MSG_INVALIDO, 'codigo_invalido'); // mesma mensagem para todos os casos
  }

  const token = randomToken();
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO sessoes_portal (liberacao_id, candidato_id, token_hash, ip, dispositivo) VALUES ($1, $2, $3, $4, $5)`,
      [l.id, l.candidato_id, hmac(`sessao-portal:${token}`), ip, dispositivo],
    );
    await db.query('UPDATE liberacoes_acesso SET primeiro_uso_em = COALESCE(primeiro_uso_em, now()) WHERE id = $1', [l.id]);
    await db.query(`INSERT INTO acessos_portal (candidato_id, liberacao_id, resultado, ip, dispositivo) VALUES ($1, $2, 'sucesso', $3, $4)`, [l.candidato_id, l.id, ip, dispositivo]);
    await auditar({ acao: 'portal.entrada', resultado: 'sucesso', item: { tipo: 'candidato', id: l.candidato_id }, ator: { usuarioNome: `Candidato ${l.nome}` }, ip, dispositivo }, db);
    await publicar(db, { tipo: 'candidato.atualizado', candidatoId: l.candidato_id, unidadeId: l.unidade_id });
  });
  res.cookie(COOKIE_PORTAL, token, {
    httpOnly: true, secure: isProd, sameSite: 'lax', path: '/',
    maxAge: Math.max(1000, new Date(l.expira_em).getTime() - Date.now()), // o cookie morre junto com a liberação
  });
  res.json({ ok: true });
}));

portalRouter.use(exigirPortal);

// ── O que o candidato vê ───────────────────────────────────────────────────
portalRouter.get('/sessao', h(async (req, res) => {
  const p = req.portal!;
  const etapas = await pool.query<{ etapa: string; situacao: string; atualizado_em: Date }>('SELECT etapa, situacao, atualizado_em FROM etapas_candidato WHERE candidato_id = $1', [p.candidatoId]);
  res.json({
    nome: p.nome, // só o primeiro nome
    expiraEm: p.expiraEm,
    podeEnviarArquivo: p.permiteArquivo,
    etapas: ETAPAS.map((e) => {
      const r = etapas.rows.find((x) => x.etapa === e);
      return { etapa: e, situacao: r?.situacao ?? 'nao_iniciada', atualizadoEm: r?.atualizado_em ?? null };
    }),
  });
}));

async function conversaId(candidatoId: string) {
  const r = await pool.query<{ id: string }>('SELECT id FROM conversas WHERE candidato_id = $1', [candidatoId]);
  if (!r.rows[0]) throw notFound('Conversa não encontrada.');
  return r.rows[0].id;
}

/** Histórico permitido: só mensagens marcadas como visíveis ao candidato. Nome da equipe não aparece. */
portalRouter.get('/mensagens', h(async (req, res) => {
  const p = req.portal!;
  const cid = await conversaId(p.candidatoId);
  const { rows } = await pool.query(
    `SELECT m.id, m.sentido, m.canal, m.autor_tipo, m.texto, m.arquivo_id, m.criado_em, a.nome_original, a.tipo_mime, a.tamanho
       FROM mensagens m LEFT JOIN arquivos a ON a.id = m.arquivo_id
      WHERE m.conversa_id = $1 AND m.visivel_ao_candidato
      ORDER BY m.criado_em DESC LIMIT 200`,
    [cid],
  );
  // O candidato leu tudo o que veio da equipe até agora.
  await pool.query(`UPDATE conversas SET candidato_lida_ate = now() WHERE id = $1`, [cid]);
  const marcadas = await pool.query(
    `UPDATE mensagens SET situacao_entrega = 'lida' WHERE conversa_id = $1 AND sentido = 'saida' AND canal = 'portal' AND situacao_entrega IS DISTINCT FROM 'lida' RETURNING id`,
    [cid],
  );
  if (marcadas.rowCount) await publicar(pool, { tipo: 'mensagem.nova', candidatoId: p.candidatoId, unidadeId: p.unidadeId });
  res.json(rows.reverse().map((m) => ({
    id: m.id,
    deMim: m.sentido === 'entrada',
    autor: m.sentido === 'entrada' ? 'Você' : m.autor_tipo === 'chatbot' ? 'Assistente virtual' : 'Equipe de RH',
    texto: decifrarSeguro(m.texto),
    em: m.criado_em,
    arquivo: m.arquivo_id ? { id: m.arquivo_id, nome: m.nome_original, tipoMime: m.tipo_mime, tamanho: Number(m.tamanho) } : null,
  })));
}));

async function gravarDoCandidato(db: PoolClient, req: Express.Request, texto: string | null, arquivoId: string | null) {
  const p = req.portal!;
  const cid = (await db.query<{ id: string }>('SELECT id FROM conversas WHERE candidato_id = $1', [p.candidatoId])).rows[0].id;
  const m = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, arquivo_id, visivel_ao_candidato)
     VALUES ($1, 'entrada', 'portal', 'candidato', $2, $3, $4, true) RETURNING id, criado_em`,
    [cid, p.nome, texto ? encrypt(texto) : null, arquivoId],
  );
  await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3, candidato_lida_ate = $3 WHERE id = $1', [cid, m.rows[0].id, m.rows[0].criado_em]);
  await db.query('UPDATE candidatos SET ultima_interacao_em = now() WHERE id = $1', [p.candidatoId]);
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['mensagem.recebida', p.candidatoId, JSON.stringify({ mensagemId: m.rows[0].id, canal: 'portal' })]);
  await auditar({ acao: 'mensagem.recebida', resultado: 'sucesso', item: { tipo: 'candidato', id: p.candidatoId }, detalhes: { canal: 'portal', mensagemId: m.rows[0].id, arquivo: Boolean(arquivoId) }, ator: ator(req), ip: ipDe(req) }, db);
  await publicar(db, { tipo: 'mensagem.nova', candidatoId: p.candidatoId, unidadeId: p.unidadeId });
  return m.rows[0].id;
}

portalRouter.post('/mensagens', h(async (req, res) => {
  const { texto } = parse(z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(2000) }), req.body);
  const id = await transaction((db) => gravarDoCandidato(db, req, texto, null));
  res.status(201).json({ id });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 } });

/** Envio de arquivo só quando a liberação permitir. */
portalRouter.post('/mensagens/arquivo', (req, res, next) => {
  if (!req.portal?.permiteArquivo) return next(forbidden('O envio de arquivos não está liberado para você agora.', 'arquivo_nao_liberado'));
  upload.single('arquivo')(req, res, (err?: unknown) => (err ? next(badRequest('Arquivo inválido ou grande demais.', 'arquivo_invalido')) : next()));
}, h(async (req, res) => {
  const f = req.file;
  if (!f) throw badRequest('Escolha um arquivo.');
  const tipo = detectarTipo(f.buffer);
  if (!tipo) throw badRequest('Envie um arquivo PDF, DOC, DOCX, JPG ou PNG.', 'arquivo_tipo');
  const limite = await cfgNumero('arquivos.curriculo_mb');
  if (f.size > limite * 1024 * 1024) throw badRequest(`O arquivo pode ter no máximo ${limite} MB.`, 'arquivo_grande');
  const gravados: ArquivoGuardado[] = [];
  try {
    const id = await transaction(async (db) => {
      const a = await guardarArquivo(db, f.buffer, f.originalname, tipo);
      gravados.push(a);
      await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo, enviado_por) VALUES ($1, $2, 'anexo', 'candidato')`, [req.portal!.candidatoId, a.id]);
      return gravarDoCandidato(db, req, null, a.id);
    });
    res.status(201).json({ id });
  } catch (err) {
    await descartarArquivos(gravados);
    throw err;
  }
}));

/** O candidato abre arquivos da própria conversa (os que pode ver). */
portalRouter.get('/arquivos/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { rows } = await pool.query(
    `SELECT a.nome_original, a.tipo_mime, a.caminho, a.sha256
       FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id JOIN arquivos a ON a.id = m.arquivo_id
      WHERE m.arquivo_id = $1 AND cv.candidato_id = $2 AND m.visivel_ao_candidato AND a.excluido_em IS NULL LIMIT 1`,
    [id, req.portal!.candidatoId],
  );
  if (!rows[0]) throw notFound('Arquivo não encontrado.');
  const conteudo = await lerArquivo(rows[0].caminho, rows[0].sha256);
  res.setHeader('Content-Type', rows[0].tipo_mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].nome_original)}`);
  res.send(conteudo);
}));

portalRouter.post('/sair', h(async (req, res) => {
  await pool.query(`UPDATE sessoes_portal SET encerrada_em = now(), motivo_encerramento = 'saiu' WHERE id = $1`, [req.portal!.sessaoId]);
  res.clearCookie(COOKIE_PORTAL, { path: '/' });
  res.json({ ok: true });
}));
