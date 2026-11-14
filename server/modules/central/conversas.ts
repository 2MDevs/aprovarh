import { Router } from 'express';
import multer from 'multer';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { auditarReq } from '../../core/audit.ts';
import { cfgNumero } from '../../core/settings.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, transaction } from '../../db/pool.ts';
import { detectarTipo, guardarArquivo, descartarArquivos, type ArquivoGuardado } from '../../lib/arquivos.ts';
import { encrypt } from '../../lib/crypto.ts';
import { badRequest, h, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { avisarMudanca, candidatoVisivel, decifrarSeguro } from './service.ts';

/**
 * Conversa única do candidato. A mesma conversa recebe o chat do portal (etapa 5), o WhatsApp (etapa 7)
 * e os avisos automáticos. Não existe conversa duplicada (conversas.candidato_id é único).
 */
export const conversasRouter = Router({ mergeParams: true });
conversasRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'));

const uuid = z.string().uuid();

async function conversaDo(db: PoolClient | typeof pool, candidatoId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO conversas (candidato_id) VALUES ($1) ON CONFLICT (candidato_id) DO UPDATE SET candidato_id = EXCLUDED.candidato_id RETURNING id`,
    [candidatoId],
  );
  return r.rows[0].id;
}

/** Mensagens, da mais nova para a mais antiga, em páginas. */
conversasRouter.get('/:id/mensagens', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const q = parse(z.object({ antes: z.string().datetime({ offset: true }).optional(), limite: z.coerce.number().int().min(10).max(100).default(50) }), req.query);
  await candidatoVisivel(req.usuario!, id);
  const conversaId = await conversaDo(pool, id);
  const { rows } = await pool.query(
    `SELECT m.id, m.sentido, m.canal, m.autor_tipo, m.autor_nome, m.texto, m.arquivo_id, m.visivel_ao_candidato,
            m.situacao_entrega, m.criado_em, a.nome_original, a.tipo_mime, a.tamanho
       FROM mensagens m LEFT JOIN arquivos a ON a.id = m.arquivo_id
      WHERE m.conversa_id = $1 AND ($2::timestamptz IS NULL OR m.criado_em < $2)
      ORDER BY m.criado_em DESC LIMIT $3`,
    [conversaId, q.antes ?? null, q.limite + 1],
  );
  const leitura = await pool.query<{ lida_ate: Date }>('SELECT lida_ate FROM conversa_leituras WHERE conversa_id = $1 AND usuario_id = $2', [conversaId, req.usuario!.id]);
  res.json({
    temMais: rows.length > q.limite,
    lidaAte: leitura.rows[0]?.lida_ate ?? null,
    mensagens: rows.slice(0, q.limite).map((m) => ({
      id: m.id, sentido: m.sentido, canal: m.canal, autorTipo: m.autor_tipo, autorNome: m.autor_nome,
      texto: decifrarSeguro(m.texto), visivelAoCandidato: m.visivel_ao_candidato, situacaoEntrega: m.situacao_entrega, em: m.criado_em,
      arquivo: m.arquivo_id ? { id: m.arquivo_id, nome: m.nome_original, tipoMime: m.tipo_mime, tamanho: Number(m.tamanho) } : null,
    })),
  });
}));

async function gravarMensagem(db: PoolClient, req: Express.Request, candidatoId: string, unidadeId: string, texto: string | null, arquivoId: string | null) {
  const conversaId = await conversaDo(db, candidatoId);
  const r = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_usuario_id, autor_nome, texto, arquivo_id, visivel_ao_candidato, situacao_entrega)
     VALUES ($1, 'saida', 'portal', 'gestora', $2, $3, $4, $5, true, 'enviada') RETURNING id, criado_em`,
    [conversaId, req.usuario!.id, req.usuario!.nome, texto ? encrypt(texto) : null, arquivoId],
  );
  await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE id = $1', [conversaId, r.rows[0].id, r.rows[0].criado_em]);
  // Quem escreve já leu a conversa até aqui.
  await db.query(
    `INSERT INTO conversa_leituras (conversa_id, usuario_id, lida_ate) VALUES ($1, $2, $3)
     ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET lida_ate = GREATEST(conversa_leituras.lida_ate, EXCLUDED.lida_ate)`,
    [conversaId, req.usuario!.id, r.rows[0].criado_em],
  );
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['mensagem.enviada', candidatoId, JSON.stringify({ mensagemId: r.rows[0].id, canal: 'portal', autor: 'gestora' })]);
  await publicar(db, { tipo: 'mensagem.nova', candidatoId, unidadeId });
  await avisarMudanca(db, candidatoId, unidadeId);
  return r.rows[0].id;
}

/**
 * Mensagem da gestora no chat interno. Ela aparece no portal quando o candidato tiver acesso (etapa 5).
 * O envio pelo WhatsApp é outra função (etapa 7), com as regras de modelos da Meta.
 */
conversasRouter.post('/:id/mensagens', exigirPermissao('conversas.responder'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { texto } = parse(z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000) }), req.body);
  const mensagemId = await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db);
    const mid = await gravarMensagem(db, req, id, c.unidade_id, texto, null);
    await auditarReq(req, { acao: 'mensagem.enviada', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { canal: 'portal', mensagemId: mid } }, db);
    return mid;
  });
  res.status(201).json({ id: mensagemId });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 2 } });

/** Arquivo enviado pela gestora no chat (PDF, DOC, DOCX, JPG ou PNG). */
conversasRouter.post('/:id/mensagens/arquivo', exigirPermissao('conversas.responder'), (req, res, next) => {
  upload.single('arquivo')(req, res, (err?: unknown) => (err ? next(badRequest('Arquivo inválido ou grande demais.', 'arquivo_invalido')) : next()));
}, h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const legenda = parse(z.string().trim().max(1000).optional(), req.body?.legenda || undefined);
  const f = req.file;
  if (!f) throw badRequest('Escolha um arquivo.');
  const tipo = detectarTipo(f.buffer);
  if (!tipo) throw badRequest('Tipo de arquivo não aceito. Envie PDF, DOC, DOCX, JPG ou PNG.', 'arquivo_tipo');
  const limite = await cfgNumero('arquivos.curriculo_mb');
  if (f.size > limite * 1024 * 1024) throw badRequest(`O arquivo pode ter no máximo ${limite} MB.`, 'arquivo_grande');
  const gravados: ArquivoGuardado[] = [];
  try {
    const mensagemId = await transaction(async (db) => {
      const c = await candidatoVisivel(req.usuario!, id, db);
      const a = await guardarArquivo(db, f.buffer, f.originalname, tipo);
      gravados.push(a);
      await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo, enviado_por) VALUES ($1, $2, 'anexo', 'gestora')`, [id, a.id]);
      const mid = await gravarMensagem(db, req, id, c.unidade_id, legenda ?? null, a.id);
      await auditarReq(req, { acao: 'mensagem.enviada', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { canal: 'portal', mensagemId: mid, arquivo: tipo } }, db);
      return mid;
    });
    res.status(201).json({ id: mensagemId });
  } catch (err) {
    await descartarArquivos(gravados);
    throw err;
  }
}));

/** Marca a conversa como lida até agora (indicador de não lidas é por pessoa). */
conversasRouter.post('/:id/lida', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await candidatoVisivel(req.usuario!, id);
  await transaction(async (db) => {
    const conversaId = await conversaDo(db, id);
    await db.query(
      `INSERT INTO conversa_leituras (conversa_id, usuario_id, lida_ate) VALUES ($1, $2, now())
       ON CONFLICT (conversa_id, usuario_id) DO UPDATE SET lida_ate = now()`,
      [conversaId, req.usuario!.id],
    );
    await publicar(db, { tipo: 'conversa.lida', candidatoId: id, usuarioId: req.usuario!.id });
  });
  res.json({ ok: true });
}));
