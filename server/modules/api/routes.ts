import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { ESCOPOS_API, type EscopoApi } from '../../../shared/permissoes.ts';
import { auditarReq } from '../../core/audit.ts';
import { pool } from '../../db/pool.ts';
import { decrypt, encrypt, hmac, randomFromAlphabet, randomToken } from '../../lib/crypto.ts';
import { forbidden, h, HttpError, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';

/** Sistema › API & Webhooks. A própria área nunca aceita chave de API. */
export const apiRouter = Router();
apiRouter.use(exigirLogin(), exigirPermissao('api.gerenciar'));

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ESCOPOS = Object.keys(ESCOPOS_API) as [EscopoApi, ...EscopoApi[]];

apiRouter.get('/escopos', (_req, res) => {
  res.json(Object.entries(ESCOPOS_API).map(([chave, e]) => ({ chave, nome: e.nome })));
});

apiRouter.get('/chaves', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT k.id, k.nome, k.prefixo, k.escopos, k.criada_em, k.ultimo_uso_em, k.ultimo_uso_ip, k.revogada_em, u.nome AS criada_por
       FROM chaves_api k JOIN usuarios u ON u.id = k.criada_por ORDER BY k.criada_em DESC`,
  );
  res.json(rows.map((k) => ({
    id: k.id, nome: k.nome, inicio: `${k.prefixo}…`, escopos: k.escopos, criadaEm: k.criada_em, criadaPor: k.criada_por,
    ultimoUsoEm: k.ultimo_uso_em, ultimoUsoIp: k.ultimo_uso_ip, revogadaEm: k.revogada_em, ativa: !k.revogada_em,
  })));
}));

/** Gera a chave no servidor: aprh_live_ + 64 caracteres. Mostrada uma única vez; só o hash fica guardado. */
apiRouter.post('/chaves', h(async (req, res) => {
  const body = parse(z.object({ nome: z.string().trim().min(2).max(120), escopos: z.array(z.enum(ESCOPOS)).min(1, 'Escolha pelo menos um escopo.') }), req.body);
  for (const e of body.escopos) {
    if (!req.usuario!.permissoes.has(ESCOPOS_API[e].exige)) throw forbidden(`Você não tem a permissão exigida pelo escopo "${ESCOPOS_API[e].nome}".`);
  }
  const chave = `aprh_live_${randomFromAlphabet(64, ALFABETO)}`;
  const r = await pool.query<{ id: string }>(
    'INSERT INTO chaves_api (nome, prefixo, hash, escopos, criada_por) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [body.nome, chave.slice(0, 16), hmac(chave), body.escopos, req.usuario!.id],
  );
  await auditarReq(req, { acao: 'chave_api.criada', resultado: 'sucesso', item: { tipo: 'chave_api', id: r.rows[0].id, nome: body.nome }, detalhes: { escopos: body.escopos } });
  res.status(201).json({ id: r.rows[0].id, chave, aviso: 'Copie a chave agora. Ela não será mostrada de novo.' });
}));

apiRouter.post('/chaves/:id/revogar', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const r = await pool.query<{ nome: string }>('UPDATE chaves_api SET revogada_em = now(), revogada_por = $2 WHERE id = $1 AND revogada_em IS NULL RETURNING nome', [id, req.usuario!.id]);
  if (!r.rowCount) throw notFound('Chave não encontrada ou já revogada.');
  await auditarReq(req, { acao: 'chave_api.revogada', resultado: 'sucesso', item: { tipo: 'chave_api', id, nome: r.rows[0].nome } });
  res.json({ ok: true });
}));

// ── Webhooks de saída (assinados, só HTTPS) ────────────────────────────────
/** Eventos disponíveis. Os de candidatos entram nas próximas etapas. */
const EVENTOS = ['webhook.teste'] as const;

const dadosWebhook = z.object({
  nome: z.string().trim().min(2).max(120),
  url: z.string().trim().url().refine((u) => u.startsWith('https://'), 'O endereço precisa começar com https://.'),
  eventos: z.array(z.enum(EVENTOS)).default([]),
  ativo: z.boolean().default(true),
});

apiRouter.get('/webhooks', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, nome, url, eventos, ativo, ultimo_disparo_em, ultimo_resultado, criado_em FROM webhooks WHERE excluido_em IS NULL ORDER BY criado_em DESC`,
  );
  res.json({ eventosDisponiveis: EVENTOS, webhooks: rows });
}));

apiRouter.post('/webhooks', h(async (req, res) => {
  const body = parse(dadosWebhook, req.body);
  const segredo = `whsec_${randomToken(24)}`;
  const r = await pool.query<{ id: string }>(
    'INSERT INTO webhooks (nome, url, eventos, segredo, ativo, criado_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [body.nome, body.url, body.eventos, encrypt(segredo), body.ativo, req.usuario!.id],
  );
  await auditarReq(req, { acao: 'webhook.criado', resultado: 'sucesso', item: { tipo: 'webhook', id: r.rows[0].id, nome: body.nome }, detalhes: { url: body.url, eventos: body.eventos } });
  res.status(201).json({ id: r.rows[0].id, segredo, aviso: 'Guarde o segredo: ele assina cada envio (cabeçalho X-AprovaRH-Assinatura).' });
}));

apiRouter.put('/webhooks/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const body = parse(dadosWebhook, req.body);
  const r = await pool.query('UPDATE webhooks SET nome = $2, url = $3, eventos = $4, ativo = $5 WHERE id = $1 AND excluido_em IS NULL', [id, body.nome, body.url, body.eventos, body.ativo]);
  if (!r.rowCount) throw notFound('Webhook não encontrado.');
  await auditarReq(req, { acao: 'webhook.alterado', resultado: 'sucesso', item: { tipo: 'webhook', id, nome: body.nome }, detalhes: body });
  res.json({ ok: true });
}));

apiRouter.delete('/webhooks/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const r = await pool.query<{ nome: string }>('UPDATE webhooks SET excluido_em = now(), ativo = false WHERE id = $1 AND excluido_em IS NULL RETURNING nome', [id]);
  if (!r.rowCount) throw notFound('Webhook não encontrado.');
  await auditarReq(req, { acao: 'webhook.excluido', resultado: 'sucesso', item: { tipo: 'webhook', id, nome: r.rows[0].nome } });
  res.json({ ok: true });
}));

/** Assinatura: HMAC-SHA256(segredo, "<timestamp>.<corpo>") no cabeçalho X-AprovaRH-Assinatura: t=...,v1=... */
export async function dispararWebhook(w: { id: string; url: string; segredo: string }, evento: string, dados: unknown) {
  const corpo = JSON.stringify({ evento, em: new Date().toISOString(), dados });
  const t = Math.floor(Date.now() / 1000);
  const assinatura = crypto.createHmac('sha256', decrypt(w.segredo)).update(`${t}.${corpo}`).digest('hex');
  let resultado: string;
  try {
    const resp = await fetch(w.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'aprovaRH-Webhooks', 'X-AprovaRH-Evento': evento, 'X-AprovaRH-Assinatura': `t=${t},v1=${assinatura}` },
      body: corpo,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    resultado = `HTTP ${resp.status}`;
  } catch (err) {
    resultado = `Falhou: ${(err as Error).message.slice(0, 80)}`;
  }
  await pool.query('UPDATE webhooks SET ultimo_disparo_em = now(), ultimo_resultado = $2 WHERE id = $1', [w.id, resultado]);
  return resultado;
}

apiRouter.post('/webhooks/:id/testar', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { rows } = await pool.query('SELECT id, nome, url, segredo FROM webhooks WHERE id = $1 AND excluido_em IS NULL', [id]);
  if (!rows[0]) throw notFound('Webhook não encontrado.');
  const resultado = await dispararWebhook(rows[0], 'webhook.teste', { mensagem: 'Teste de disparo do aprovaRH.' });
  const ok = resultado.startsWith('HTTP 2');
  await auditarReq(req, { acao: 'webhook.testado', resultado: ok ? 'sucesso' : 'falha', item: { tipo: 'webhook', id, nome: rows[0].nome }, detalhes: { resultado } });
  if (!ok) throw new HttpError(502, `O endereço respondeu: ${resultado}`, 'webhook_falhou');
  res.json({ ok: true, resultado });
}));

