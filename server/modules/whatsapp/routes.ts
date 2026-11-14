import express, { Router } from 'express';
import { z } from 'zod';
import { auditar, auditarReq } from '../../core/audit.ts';
import { pool, transaction } from '../../db/pool.ts';
import { decrypt, hmac } from '../../lib/crypto.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { badRequest, h, HttpError, ipDe, notFound, parse } from '../../lib/http.ts';
import { exigirDesenvolvedor, exigirLogin, exigirPermissao, exigirReautenticacao } from '../../middleware/auth.ts';
import { candidatoVisivel, formatarTelefone } from '../central/service.ts';
import {
  assinaturaMetaValida, configWhatsapp, faltandoWhatsapp, listarModelos, testarConexao, tokenEvolutionValido, whatsappConfigurado,
} from './cliente.ts';
import { eventosEvolution, eventosMeta, guardarEventos } from './entrada.ts';
import { enfileirar } from './envio.ts';

// ═══════════════════════ Webhooks (públicos, conferidos por assinatura/token) ═══════════════════════
export const webhooksRouter = Router();

async function negar(req: express.Request, motivo: string) {
  await auditar({ acao: 'whatsapp.webhook_recusado', resultado: 'negado', detalhes: { motivo, caminho: req.path }, ator: { usuarioNome: 'Webhook do WhatsApp' }, ip: ipDe(req), dispositivo: descreverDispositivo(req.get('user-agent')).nome });
}

/** Meta: verificação do endereço (feita uma vez, ao cadastrar o webhook no painel da Meta). */
webhooksRouter.get('/whatsapp', h(async (req, res) => {
  const { meta } = await configWhatsapp();
  const ok = req.query['hub.mode'] === 'subscribe' && meta.verifyToken && req.query['hub.verify_token'] === meta.verifyToken;
  if (!ok) {
    await negar(req, 'token de verificação incorreto');
    throw new HttpError(403, 'Verificação recusada.', 'verificacao_recusada');
  }
  res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
}));

/** Meta: mensagens e situação de entrega. Corpo bruto para conferir a assinatura X-Hub-Signature-256. */
webhooksRouter.post('/whatsapp', express.raw({ type: '*/*', limit: '2mb' }), h(async (req, res) => {
  const { meta } = await configWhatsapp();
  const bruto = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!meta.appSecret || !assinaturaMetaValida(bruto, req.get('x-hub-signature-256'), meta.appSecret)) {
    await negar(req, 'assinatura inválida');
    throw new HttpError(401, 'Assinatura inválida.', 'assinatura_invalida');
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch {
    throw badRequest('Corpo inválido.');
  }
  await guardarEventos(eventosMeta(corpo as Parameters<typeof eventosMeta>[0]));
  res.sendStatus(200); // responde rápido; o Worker processa
}));

/** Evolution API: token secreto no cabeçalho x-aprovarh-token e instância conferida. */
webhooksRouter.post(['/evolution', '/evolution/:evento'], express.json({ limit: '2mb' }), h(async (req, res) => {
  const { evolution } = await configWhatsapp();
  if (!evolution.webhookToken || !tokenEvolutionValido(req.get('x-aprovarh-token'), evolution.webhookToken)) {
    await negar(req, 'token do webhook incorreto');
    throw new HttpError(401, 'Token inválido.', 'token_invalido');
  }
  const corpo = req.body as { event?: string; instance?: string; data?: unknown };
  if (evolution.instancia && corpo.instance && corpo.instance !== evolution.instancia) {
    await negar(req, 'instância diferente da configurada');
    throw new HttpError(403, 'Instância não reconhecida.', 'instancia_invalida');
  }
  // Com "webhook por eventos", o nome do evento vem no endereço (/evolution/messages-upsert).
  const evento = corpo.event ?? String(req.params.evento ?? '').replace(/-/g, '.');
  await guardarEventos(eventosEvolution({ event: evento, data: corpo.data }));
  res.sendStatus(200);
}));

// ═══════════════════════ Tela Integração › WhatsApp (só Desenvolvedor) ═══════════════════════
export const whatsappIntegracaoRouter = Router();
whatsappIntegracaoRouter.use(exigirLogin(), exigirDesenvolvedor, exigirReautenticacao);

whatsappIntegracaoRouter.get('/situacao', h(async (_req, res) => {
  const c = await configWhatsapp();
  const fila = await pool.query<{ situacao: string; n: number }>(`SELECT situacao, count(*)::int AS n FROM fila_envio WHERE criada_em > now() - interval '7 days' GROUP BY situacao`);
  const entrada = await pool.query<{ pendentes: number; erros: number; ultimo: Date | null }>(
    `SELECT count(*) FILTER (WHERE processado_em IS NULL)::int AS pendentes, count(*) FILTER (WHERE erro IS NOT NULL AND recebido_em > now() - interval '7 days')::int AS erros, max(recebido_em) AS ultimo FROM whatsapp_eventos_entrada`,
  );
  res.json({
    provedor: c.provedor,
    configurado: await whatsappConfigurado(),
    faltando: await faltandoWhatsapp(),
    webhook: c.provedor === 'meta' ? '/api/webhooks/whatsapp' : '/api/webhooks/evolution',
    fila: Object.fromEntries(fila.rows.map((r) => [r.situacao, r.n])),
    entrada: entrada.rows[0],
  });
}));

whatsappIntegracaoRouter.post('/testar', h(async (req, res) => {
  try {
    const texto = await testarConexao();
    await auditarReq(req, { acao: 'whatsapp.teste_conexao', resultado: 'sucesso' });
    res.json({ ok: true, texto });
  } catch (err) {
    await auditarReq(req, { acao: 'whatsapp.teste_conexao', resultado: 'falha', detalhes: { erro: (err as Error).message } });
    throw new HttpError(502, (err as Error).message, 'whatsapp_falhou');
  }
}));

/** Meta: traz os modelos da conta para escolher na tela. */
whatsappIntegracaoRouter.post('/modelos/sincronizar', h(async (req, res) => {
  let modelos;
  try {
    modelos = await listarModelos();
  } catch (err) {
    throw new HttpError(502, (err as Error).message, 'whatsapp_falhou');
  }
  await transaction(async (db) => {
    for (const m of modelos) {
      const corpo = m.components?.find((c) => c.type === 'BODY')?.text ?? null;
      const variaveis = new Set((corpo ?? '').match(/\{\{\d+\}\}/g) ?? []).size;
      const botoes = m.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
      await db.query(
        `INSERT INTO whatsapp_modelos (meta_id, nome, idioma, categoria, situacao, corpo, variaveis, botoes, sincronizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (nome, idioma) DO UPDATE SET meta_id = EXCLUDED.meta_id, categoria = EXCLUDED.categoria, situacao = EXCLUDED.situacao,
           corpo = EXCLUDED.corpo, variaveis = EXCLUDED.variaveis, botoes = EXCLUDED.botoes, sincronizado_em = now()`,
        [m.id, m.name, m.language, m.category, m.status, corpo, variaveis, JSON.stringify(botoes)],
      );
    }
    await db.query('DELETE FROM whatsapp_modelos WHERE sincronizado_em < now() - interval \'1 minute\'');
    await auditarReq(req, { acao: 'whatsapp.modelos_sincronizados', resultado: 'sucesso', detalhes: { total: modelos.length } }, db);
  });
  res.json({ ok: true, total: modelos.length });
}));

whatsappIntegracaoRouter.get('/modelos', h(async (_req, res) => {
  const { rows } = await pool.query(`SELECT nome, idioma, categoria, situacao, corpo, variaveis, botoes, sincronizado_em FROM whatsapp_modelos ORDER BY nome, idioma`);
  res.json(rows);
}));

// ═══════════════════════ Central: enviar pelo WhatsApp e contatos não identificados ═══════════════════════
export const whatsappCentralRouter = Router();
whatsappCentralRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'));

/** Situação para a tela de conversa: configurado? janela aberta (Meta)? */
whatsappCentralRouter.get('/candidatos/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  await candidatoVisivel(req.usuario!, id);
  const c = await configWhatsapp();
  const r = await pool.query<{ janela_whatsapp_ate: Date | null }>('SELECT janela_whatsapp_ate FROM conversas WHERE candidato_id = $1', [id]);
  const janelaAte = r.rows[0]?.janela_whatsapp_ate ?? null;
  const configurado = await whatsappConfigurado();
  res.json({
    configurado, provedor: c.provedor, janelaAte,
    podeTextoLivre: configurado && (c.provedor === 'evolution' || Boolean(janelaAte && new Date(janelaAte) > new Date())),
  });
}));

/** Mensagem da gestora pelo WhatsApp (decisão D14). Meta: só dentro da janela de 24 h. */
whatsappCentralRouter.post('/candidatos/:id/mensagens', exigirPermissao('conversas.responder'), h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const { texto } = parse(z.object({ texto: z.string().trim().min(1, 'Escreva a mensagem.').max(4000) }), req.body);
  const mensagemId = await transaction(async (db) => {
    const c = await candidatoVisivel(req.usuario!, id, db);
    const mid = await enfileirar(db, {
      candidatoId: id, conteudo: { tipo: 'texto', texto },
      autor: { tipo: 'gestora', usuarioId: req.usuario!.id, nome: req.usuario!.nome },
      chaveIdempotencia: `gestora:${req.usuario!.id}:${id}:${hmac(texto).slice(0, 16)}:${Math.floor(Date.now() / 5000)}`, // clique duplo não manda duas vezes
    });
    await auditarReq(req, { acao: 'mensagem.enviada', resultado: 'sucesso', item: { tipo: 'candidato', id, nome: c.codigo }, detalhes: { canal: 'whatsapp', mensagemId: mid } }, db);
    await db.query('UPDATE candidatos SET ultima_interacao_em = now() WHERE id = $1', [id]);
    return mid;
  });
  res.status(201).json({ id: mensagemId });
}));

whatsappCentralRouter.get('/nao-identificados', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, telefone, nome_perfil, ultima_mensagem, mensagens, primeira_em, ultima_em FROM contatos_nao_identificados
      WHERE arquivado_em IS NULL AND vinculado_a IS NULL ORDER BY ultima_em DESC LIMIT 200`,
  );
  await auditarReq(req, { acao: 'whatsapp.nao_identificados_visualizados', resultado: 'sucesso', detalhes: { total: rows.length } });
  res.json(rows.map((r) => {
    let tel: string | null = null;
    let msg: string | null = null;
    try { tel = formatarTelefone(decrypt(r.telefone)); } catch { /* chave trocada */ }
    try { msg = decrypt(r.ultima_mensagem); } catch { /* idem */ }
    return { id: r.id, telefone: tel, nomePerfil: r.nome_perfil, ultimaMensagem: msg, mensagens: r.mensagens, primeiraEm: r.primeira_em, ultimaEm: r.ultima_em };
  }));
}));

whatsappCentralRouter.post('/nao-identificados/:id/arquivar', exigirPermissao('conversas.responder'), h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const r = await pool.query('UPDATE contatos_nao_identificados SET arquivado_em = now() WHERE id = $1 AND arquivado_em IS NULL', [id]);
  if (!r.rowCount) throw notFound('Contato não encontrado.');
  await auditarReq(req, { acao: 'whatsapp.nao_identificado_arquivado', resultado: 'sucesso', item: { tipo: 'contato', id } });
  res.json({ ok: true });
}));

