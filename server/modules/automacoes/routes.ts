import { Router, type Request } from 'express';
import { z } from 'zod';
import { CARD, LIMITES, gatilhoDo, validarFluxo, fluxoDeReferencia, type ContextoValidacao, type Fluxo } from '../../../shared/automacoes.ts';
import { filtroUnidades } from '../../core/access.ts';
import { auditarReq } from '../../core/audit.ts';
import { pool, transaction } from '../../db/pool.ts';
import { instanteEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { badRequest, conflict, forbidden, h, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { horariosDaUnidade } from '../entrevistas/servico.ts';
import { configWhatsapp, whatsappConfigurado } from '../whatsapp/cliente.ts';
import type { UsuarioContexto } from '../../types.d.ts';
import { efeitosDeTeste, simular, type CandidatoAtual } from './cards.ts';
import { nomeDe } from './efeitos.ts';
import { configMotor, encerrar } from './motor.ts';

/**
 * Automações: gestão, rascunho, publicação (versão imutável), teste sem envio e histórico de execuções.
 * Escopo de unidade: quem não enxerga todas as unidades só vê e cria automações das suas unidades.
 */
export const automacoesRouter = Router();
automacoesRouter.use(exigirLogin(), exigirPermissao('automacoes.ver'));

const uuid = z.string().uuid();
const SITUACAO_EXECUCAO = ['em_andamento', 'aguardando', 'concluida', 'com_erro', 'interrompida'] as const;

const noSchema = z.object({
  id: z.string().min(1).max(40).regex(/^[\w-]+$/),
  tipo: z.string().max(60),
  params: z.record(z.string(), z.unknown()).default({}),
  posicao: z.object({ x: z.number().finite(), y: z.number().finite() }),
  nome: z.string().max(80).optional(),
});
const fluxoSchema = z.object({
  nos: z.array(noSchema).max(LIMITES.nos),
  ligacoes: z.array(z.object({ id: z.string().max(100), de: z.string().max(40), saida: z.string().max(30), para: z.string().max(40) })).max(LIMITES.nos * 4),
});

/** Pode ver/editar: vê todas as unidades, ou a automação vale só para unidades suas. */
function alcanca(u: UsuarioContexto, unidades: string[] | null): boolean {
  const minhas = filtroUnidades(u);
  if (minhas === null) return true;
  return Boolean(unidades?.length) && unidades!.every((id) => minhas.includes(id));
}

function conferirUnidades(u: UsuarioContexto, unidades: string[] | null) {
  if (filtroUnidades(u) !== null && !unidades?.length) throw badRequest('Escolha as unidades em que a automação vale.');
  if (!alcanca(u, unidades)) throw forbidden('Você só pode criar automações para as suas unidades.');
}

async function carregarAutomacao(u: UsuarioContexto, id: string) {
  const r = await pool.query<{ id: string; nome: string; descricao: string | null; situacao: string; unidades: string[] | null; fluxo_rascunho: Fluxo; versao_publicada_id: string | null; rascunho_alterado_em: Date }>(
    'SELECT id, nome, descricao, situacao, unidades, fluxo_rascunho, versao_publicada_id, rascunho_alterado_em FROM automacoes WHERE id = $1 AND excluida_em IS NULL', [id],
  );
  const a = r.rows[0];
  if (!a || !alcanca(u, a.unidades)) throw notFound('Automação não encontrada.');
  return a;
}

/** O que a validação precisa saber do banco (status, tags, unidades que a pessoa enxerga, WhatsApp). */
async function contextoValidacao(u: UsuarioContexto): Promise<ContextoValidacao> {
  const minhas = filtroUnidades(u);
  const [st, tg, un] = await Promise.all([
    pool.query<{ id: string }>('SELECT id FROM status WHERE ativo'),
    pool.query<{ id: string }>('SELECT id FROM tags WHERE ativa'),
    pool.query<{ id: string }>('SELECT id FROM unidades WHERE excluido_em IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1))', [minhas]),
  ]);
  return {
    statusIds: st.rows.map((r) => r.id), tagIds: tg.rows.map((r) => r.id), unidadeIds: un.rows.map((r) => r.id),
    whatsappConfigurado: await whatsappConfigurado(), provedor: (await configWhatsapp()).provedor,
  };
}

// ── Lista e opções do construtor ─────────────────────────────────────────────
automacoesRouter.get('/', h(async (req, res) => {
  const minhas = filtroUnidades(req.usuario!);
  const { rows } = await pool.query(
    `SELECT a.id, a.nome, a.descricao, a.situacao, a.unidades, a.atualizada_em, a.rascunho_alterado_em, uc.nome AS criador,
            v.numero AS versao, v.gatilho, v.publicada_em,
            (SELECT count(*)::int FROM automacao_execucoes x WHERE x.automacao_id = a.id) AS execucoes,
            (SELECT count(*)::int FROM automacao_execucoes x WHERE x.automacao_id = a.id AND x.situacao IN ('em_andamento', 'aguardando')) AS ativas,
            (SELECT count(*)::int FROM automacao_execucoes x WHERE x.automacao_id = a.id AND x.situacao = 'com_erro') AS com_erro,
            (SELECT max(iniciada_em) FROM automacao_execucoes x WHERE x.automacao_id = a.id) AS ultima_execucao
       FROM automacoes a LEFT JOIN usuarios uc ON uc.id = a.criada_por LEFT JOIN automacao_versoes v ON v.id = a.versao_publicada_id
      WHERE a.excluida_em IS NULL AND ($1::uuid[] IS NULL OR (a.unidades IS NOT NULL AND a.unidades <@ $1))
      ORDER BY a.atualizada_em DESC`,
    [minhas],
  );
  res.json(rows.map((a) => ({
    id: a.id, nome: a.nome, descricao: a.descricao, situacao: a.situacao, unidades: a.unidades, criador: a.criador,
    atualizadaEm: a.atualizada_em, rascunhoAlteradoEm: a.rascunho_alterado_em,
    versao: a.versao, gatilho: a.gatilho ? CARD[a.gatilho]?.nome ?? a.gatilho : null, publicadaEm: a.publicada_em,
    execucoes: a.execucoes, ativas: a.ativas, comErro: a.com_erro, ultimaExecucao: a.ultima_execucao,
  })));
}));

automacoesRouter.get('/opcoes', h(async (req, res) => {
  const minhas = filtroUnidades(req.usuario!);
  const [st, tg, un] = await Promise.all([
    pool.query('SELECT id, nome, cor FROM status WHERE ativo ORDER BY ordem, nome'),
    pool.query('SELECT id, nome, cor FROM tags WHERE ativa ORDER BY nome'),
    pool.query('SELECT id, nome FROM unidades WHERE excluido_em IS NULL AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY nome', [minhas]),
  ]);
  res.json({
    status: st.rows, tags: tg.rows, unidades: un.rows, todasUnidades: minhas === null,
    whatsapp: { configurado: await whatsappConfigurado(), provedor: (await configWhatsapp()).provedor },
  });
}));

// ── Criar, ver, salvar rascunho, duplicar, excluir ──────────────────────────
const dadosSchema = z.object({
  nome: z.string().trim().min(2, 'Dê um nome à automação.').max(120),
  descricao: z.string().trim().max(500).nullable().optional(),
  unidades: z.array(uuid).max(200).nullable().optional(),
});

async function criar(req: Request, nome: string, descricao: string | null, unidades: string[] | null, fluxo: Fluxo) {
  return transaction(async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO automacoes (nome, descricao, unidades, fluxo_rascunho, criada_por, atualizada_por) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
      [nome, descricao, unidades, JSON.stringify(fluxo), req.usuario!.id],
    );
    await auditarReq(req, { acao: 'automacao.criada', resultado: 'sucesso', item: { tipo: 'automacao', id: r.rows[0].id, nome } }, db);
    return r.rows[0].id;
  });
}

automacoesRouter.post('/', exigirPermissao('automacoes.editar'), h(async (req, res) => {
  const b = parse(dadosSchema, req.body);
  const unidades = b.unidades?.length ? b.unidades : null;
  conferirUnidades(req.usuario!, unidades);
  res.status(201).json({ id: await criar(req, b.nome, b.descricao ?? null, unidades, { nos: [], ligacoes: [] }) });
}));

/** Fluxo de referência (seção 9.4): cria um rascunho para a gestora ajustar, testar e publicar. */
automacoesRouter.post('/modelo', exigirPermissao('automacoes.editar'), h(async (req, res) => {
  const { unidades } = parse(z.object({ unidades: z.array(uuid).max(200).nullable().optional() }), req.body ?? {});
  const u = unidades?.length ? unidades : null;
  conferirUnidades(req.usuario!, u);
  const id = await criar(req, 'Confirmação de presença na entrevista', 'Modelo de referência: no dia da entrevista, envia o código e pergunta se o candidato confirma. Se não, oferece outras datas.', u, fluxoDeReferencia());
  res.status(201).json({ id });
}));

automacoesRouter.get('/:id', h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  const versoes = await pool.query(
    `SELECT v.id, v.numero, v.publicada_em, u.nome AS publicada_por, v.id = $2 AS atual FROM automacao_versoes v LEFT JOIN usuarios u ON u.id = v.publicada_por
      WHERE v.automacao_id = $1 ORDER BY v.numero DESC`,
    [a.id, a.versao_publicada_id],
  );
  const publicada = a.versao_publicada_id ? await pool.query<{ fluxo: Fluxo }>('SELECT fluxo FROM automacao_versoes WHERE id = $1', [a.versao_publicada_id]) : null;
  const fluxoPublicado = publicada?.rows[0]?.fluxo ?? null;
  res.json({
    id: a.id, nome: a.nome, descricao: a.descricao, situacao: a.situacao, unidades: a.unidades, rascunhoAlteradoEm: a.rascunho_alterado_em,
    fluxo: a.fluxo_rascunho,
    rascunhoDiferente: !fluxoPublicado || JSON.stringify(fluxoPublicado) !== JSON.stringify(a.fluxo_rascunho),
    problemas: validarFluxo(a.fluxo_rascunho, await contextoValidacao(req.usuario!)),
    versoes: versoes.rows.map((v) => ({ id: v.id, numero: v.numero, publicadaEm: v.publicada_em, publicadaPor: v.publicada_por, atual: v.atual })),
  });
}));

automacoesRouter.get('/:id/versoes/:versaoId', h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  const v = await pool.query('SELECT numero, fluxo, publicada_em FROM automacao_versoes WHERE id = $1 AND automacao_id = $2', [parse(uuid, req.params.versaoId), a.id]);
  if (!v.rows[0]) throw notFound('Versão não encontrada.');
  res.json({ numero: v.rows[0].numero, fluxo: v.rows[0].fluxo, publicadaEm: v.rows[0].publicada_em });
}));

/** Salva o rascunho. A versão publicada não muda: as execuções em andamento terminam nela. */
automacoesRouter.put('/:id', exigirPermissao('automacoes.editar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(dadosSchema.extend({ fluxo: fluxoSchema }), req.body);
  const a = await carregarAutomacao(req.usuario!, id);
  const unidades = b.unidades === undefined ? a.unidades : b.unidades?.length ? b.unidades : null;
  conferirUnidades(req.usuario!, unidades);
  await transaction(async (db) => {
    await db.query(
      `UPDATE automacoes SET nome = $2, descricao = $3, unidades = $4, fluxo_rascunho = $5, rascunho_alterado_em = now(), atualizada_por = $6, atualizada_em = now() WHERE id = $1`,
      [id, b.nome, b.descricao ?? null, unidades, JSON.stringify(b.fluxo), req.usuario!.id],
    );
    await auditarReq(req, { acao: 'automacao.editada', resultado: 'sucesso', item: { tipo: 'automacao', id, nome: b.nome }, detalhes: { cards: b.fluxo.nos.length } }, db);
  });
  res.json({ ok: true, problemas: validarFluxo(b.fluxo, await contextoValidacao(req.usuario!)) });
}));

automacoesRouter.post('/:id/duplicar', exigirPermissao('automacoes.editar'), h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  res.status(201).json({ id: await criar(req, `${a.nome} (cópia)`.slice(0, 120), a.descricao, a.unidades, a.fluxo_rascunho) });
}));

automacoesRouter.delete('/:id', exigirPermissao('automacoes.editar'), h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  await transaction(async (db) => {
    const ativas = await db.query(`SELECT 1 FROM automacao_execucoes WHERE automacao_id = $1 AND situacao IN ('em_andamento', 'aguardando') LIMIT 1`, [a.id]);
    if (ativas.rowCount) throw conflict('Há execuções em andamento. Pause a automação e interrompa as execuções antes de excluir.');
    await db.query(`UPDATE automacoes SET excluida_em = now(), situacao = 'pausada', atualizada_por = $2, atualizada_em = now() WHERE id = $1`, [a.id, req.usuario!.id]);
    await auditarReq(req, { acao: 'automacao.excluida', resultado: 'sucesso', item: { tipo: 'automacao', id: a.id, nome: a.nome } }, db);
  });
  res.json({ ok: true });
}));

// ── Publicar, ativar, pausar ─────────────────────────────────────────────────
automacoesRouter.post('/:id/publicar', exigirPermissao('automacoes.publicar'), h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  const problemas = validarFluxo(a.fluxo_rascunho, await contextoValidacao(req.usuario!));
  const erros = problemas.filter((p) => !p.aviso);
  if (erros.length) {
    res.status(400).json({ erro: `Corrija ${erros.length} problema(s) antes de publicar.`, codigo: 'fluxo_invalido', problemas });
    return;
  }
  const g = gatilhoDo(a.fluxo_rascunho)!;
  const versao = await transaction(async (db) => {
    const n = await db.query<{ n: number }>('SELECT COALESCE(max(numero), 0) + 1 AS n FROM automacao_versoes WHERE automacao_id = $1', [a.id]);
    const v = await db.query<{ id: string }>(
      `INSERT INTO automacao_versoes (automacao_id, numero, fluxo, gatilho, espera_resposta, publicada_por) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [a.id, n.rows[0].n, JSON.stringify(a.fluxo_rascunho), g.tipo, a.fluxo_rascunho.nos.some((x) => x.tipo === 'tempo.aguardar_resposta'), req.usuario!.id],
    );
    await db.query(`UPDATE automacoes SET versao_publicada_id = $2, situacao = 'ativa', atualizada_por = $3, atualizada_em = now() WHERE id = $1`, [a.id, v.rows[0].id, req.usuario!.id]);
    await auditarReq(req, { acao: 'automacao.publicada', resultado: 'sucesso', item: { tipo: 'automacao', id: a.id, nome: a.nome }, detalhes: { versao: n.rows[0].n } }, db);
    return n.rows[0].n;
  });
  res.json({ ok: true, versao, problemas });
}));

for (const acao of ['ativar', 'pausar'] as const) {
  automacoesRouter.post(`/:id/${acao}`, exigirPermissao('automacoes.publicar'), h(async (req, res) => {
    const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
    if (acao === 'ativar' && !a.versao_publicada_id) throw badRequest('Publique a automação antes de ativar.');
    await transaction(async (db) => {
      await db.query(`UPDATE automacoes SET situacao = $2, atualizada_por = $3, atualizada_em = now() WHERE id = $1`, [a.id, acao === 'ativar' ? 'ativa' : 'pausada', req.usuario!.id]);
      await auditarReq(req, { acao: acao === 'ativar' ? 'automacao.ativada' : 'automacao.pausada', resultado: 'sucesso', item: { tipo: 'automacao', id: a.id, nome: a.nome } }, db);
    });
    res.json({ ok: true });
  }));
}

// ── Teste (sem enviar nada, sem gravar nada) ─────────────────────────────────
const simulacaoSchema = z.object({
  fluxo: fluxoSchema.optional(),
  unidadeId: uuid,
  nome: z.string().trim().max(60).default('Candidato de teste'),
  statusId: uuid.optional(),
  tagIds: z.array(uuid).max(50).default([]),
  respostas: z.array(z.string().max(500)).max(20).default([]),
  entrevista: z.object({ situacao: z.enum(['aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada']), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hora: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().default(null),
  acessoAtivo: z.boolean().default(false),
  janelaAberta: z.boolean().default(true),
});

automacoesRouter.post('/:id/testar', h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  const s = parse(simulacaoSchema, req.body);
  const fluxo = s.fluxo ?? a.fluxo_rascunho;
  const minhas = filtroUnidades(req.usuario!);
  if (minhas && !minhas.includes(s.unidadeId)) throw forbidden('Escolha uma das suas unidades.');
  const un = await pool.query<{ nome: string }>('SELECT nome FROM unidades WHERE id = $1 AND excluido_em IS NULL', [s.unidadeId]);
  if (!un.rows[0]) throw badRequest('Unidade não encontrada.');
  const estrutura = validarFluxo(fluxo).filter((p) => !p.aviso && !p.noId);
  if (estrutura.length) throw badRequest(`O fluxo ainda não pode ser testado: ${estrutura[0].mensagem}`);
  const inicial = s.statusId ?? (await pool.query<{ id: string }>(`SELECT id FROM status WHERE ativo ORDER BY ordem LIMIT 1`)).rows[0]?.id ?? '';
  const cand: CandidatoAtual = {
    id: 'simulado', nome: s.nome.split(' ')[0] || 'Candidato', unidadeId: s.unidadeId, unidadeNome: un.rows[0].nome, statusId: inicial, tagIds: [...s.tagIds],
    entrevista: s.entrevista ? { id: 'simulada', situacao: s.entrevista.situacao, inicioEm: instanteEmBrasilia(s.entrevista.data, s.entrevista.hora).toISOString() } : null,
    acessoAtivo: s.acessoAtivo,
  };
  // Só leitura: horários reais da unidade e nomes de status/tags. Nada é enviado nem gravado.
  const leitura = {
    horarios: (de: string, ate: string) => horariosDaUnidade(pool, s.unidadeId, de, ate),
    nomeStatus: (id: string) => nomeDe(pool, 'status', id),
    nomeTag: (id: string) => nomeDe(pool, 'tags', id),
  };
  const ef = efeitosDeTeste(cand, leitura, { janelaAberta: s.janelaAberta, provedor: (await configWhatsapp()).provedor });
  const r = await simular(fluxo, cand, { evento: { tipo: 'teste', dados: {} } }, ef, await configMotor(), s.respostas);
  await auditarReq(req, { acao: 'automacao.testada', resultado: 'sucesso', item: { tipo: 'automacao', id: a.id, nome: a.nome }, detalhes: { passos: r.passos.length } });
  res.json({
    ...r,
    nadaFoiEnviado: true,
    candidatoNoFim: {
      status: cand.statusId ? await nomeDe(pool, 'status', cand.statusId) : null,
      tags: await Promise.all(cand.tagIds.map((t) => nomeDe(pool, 'tags', t))),
      entrevista: cand.entrevista ? { situacao: cand.entrevista.situacao, ...partesEmBrasilia(new Date(cand.entrevista.inicioEm)) } : null,
      acessoAtivo: cand.acessoAtivo,
    },
  });
}));

// ── Execuções ────────────────────────────────────────────────────────────────
automacoesRouter.get('/:id/execucoes', h(async (req, res) => {
  const a = await carregarAutomacao(req.usuario!, parse(uuid, req.params.id));
  const q = parse(z.object({ situacao: z.enum(SITUACAO_EXECUCAO).optional(), pagina: z.coerce.number().int().min(1).default(1) }), req.query);
  const { rows } = await pool.query(
    `SELECT x.id, x.numero, x.situacao, x.passos, x.erro, x.iniciada_em, x.atualizada_em, x.finalizada_em, v.numero AS versao,
            c.id AS candidato_id, c.nome || ' ' || c.sobrenome AS candidato, c.codigo
       FROM automacao_execucoes x JOIN automacao_versoes v ON v.id = x.versao_id JOIN candidatos c ON c.id = x.candidato_id
      WHERE x.automacao_id = $1 AND ($2::text IS NULL OR x.situacao = $2)
      ORDER BY x.iniciada_em DESC LIMIT 51 OFFSET $3`,
    [a.id, q.situacao ?? null, (q.pagina - 1) * 50],
  );
  res.json({
    temMais: rows.length > 50,
    execucoes: rows.slice(0, 50).map((x) => ({
      id: x.id, numero: Number(x.numero), situacao: x.situacao, passos: x.passos, erro: x.erro, versao: x.versao,
      iniciadaEm: x.iniciada_em, atualizadaEm: x.atualizada_em, finalizadaEm: x.finalizada_em,
      candidato: { id: x.candidato_id, nome: x.candidato, codigo: x.codigo },
    })),
  });
}));

/** Execução e o que já veio dela (para o candidato e para a Central). */
async function carregarExecucao(u: UsuarioContexto, id: string) {
  const r = await pool.query<{ id: string; numero: string; situacao: string; automacao_id: string; unidades: string[] | null; nome: string; versao_id: string; no_atual: string | null; candidato_id: string; erro: string | null }>(
    `SELECT x.id, x.numero::text, x.situacao, x.automacao_id, a.unidades, a.nome, x.versao_id, x.no_atual, x.candidato_id, x.erro
       FROM automacao_execucoes x JOIN automacoes a ON a.id = x.automacao_id WHERE x.id = $1`, [id],
  );
  const x = r.rows[0];
  if (!x || !alcanca(u, x.unidades)) throw notFound('Execução não encontrada.');
  return x;
}

automacoesRouter.get('/execucoes/:execId', h(async (req, res) => {
  const x = await carregarExecucao(req.usuario!, parse(uuid, req.params.execId));
  const [passos, esperas, cand, versao] = await Promise.all([
    pool.query(`SELECT no_id, tipo_card, situacao, saida, resumo, erro, tentativa, em FROM automacao_passos WHERE execucao_id = $1 ORDER BY id`, [x.id]),
    pool.query(`SELECT no_id, tipo, retomar_em, prazo_em FROM automacao_esperas WHERE execucao_id = $1 AND resolvida_em IS NULL`, [x.id]),
    pool.query(`SELECT nome || ' ' || sobrenome AS nome, codigo FROM candidatos WHERE id = $1`, [x.candidato_id]),
    pool.query<{ numero: number; fluxo: Fluxo }>('SELECT numero, fluxo FROM automacao_versoes WHERE id = $1', [x.versao_id]),
  ]);
  const nomeNo = (id: string) => {
    const n = versao.rows[0]?.fluxo.nos.find((y) => y.id === id);
    return n ? n.nome || CARD[n.tipo]?.nome || n.tipo : id;
  };
  res.json({
    id: x.id, numero: Number(x.numero), situacao: x.situacao, erro: x.erro, automacao: { id: x.automacao_id, nome: x.nome }, versao: versao.rows[0]?.numero,
    noAtual: x.no_atual, candidato: { id: x.candidato_id, ...cand.rows[0] },
    passos: passos.rows.map((p) => ({ noId: p.no_id, nome: p.tipo_card === '-' ? 'Execução' : nomeNo(p.no_id), categoria: CARD[p.tipo_card]?.categoria ?? null, situacao: p.situacao, saida: p.saida, resumo: p.resumo, erro: p.erro, tentativa: p.tentativa, em: p.em })),
    esperando: esperas.rows.map((w) => ({ noId: w.no_id, nome: nomeNo(w.no_id), tipo: w.tipo, ate: w.retomar_em ?? w.prazo_em })),
  });
}));

automacoesRouter.post('/execucoes/:execId/interromper', exigirPermissao('automacoes.publicar'), h(async (req, res) => {
  const x = await carregarExecucao(req.usuario!, parse(uuid, req.params.execId));
  if (!['em_andamento', 'aguardando', 'com_erro'].includes(x.situacao)) throw conflict('Esta execução já terminou.');
  await transaction(async (db) => {
    await db.query('SELECT 1 FROM automacao_execucoes WHERE id = $1 FOR UPDATE', [x.id]);
    await encerrar(db, x.id, `Interrompida por ${req.usuario!.nome}.`, req.usuario!.id);
    await auditarReq(req, { acao: 'automacao.execucao_interrompida', resultado: 'sucesso', item: { tipo: 'automacao', id: x.automacao_id, nome: x.nome }, detalhes: { execucao: Number(x.numero) } }, db);
  });
  res.json({ ok: true });
}));

/** Reprocessa a partir do passo que falhou. Envios já feitos não se repetem (chave de idempotência). */
automacoesRouter.post('/execucoes/:execId/reprocessar', exigirPermissao('automacoes.publicar'), h(async (req, res) => {
  const x = await carregarExecucao(req.usuario!, parse(uuid, req.params.execId));
  if (x.situacao !== 'com_erro') throw conflict('Só dá para reprocessar uma execução com erro.');
  await transaction(async (db) => {
    try {
      await db.query(`UPDATE automacao_execucoes SET situacao = 'em_andamento', erro = NULL, tentativas_no = 0, proxima_tentativa_em = NULL, atualizada_em = now() WHERE id = $1 AND situacao = 'com_erro'`, [x.id]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw conflict('O candidato já tem outra execução desta automação em andamento.');
      throw err;
    }
    await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, resumo) VALUES ($1, $2, '-', 'concluido', $3)`, [x.id, x.no_atual ?? '-', `Reprocessada por ${req.usuario!.nome}.`]);
    await auditarReq(req, { acao: 'automacao.execucao_reprocessada', resultado: 'sucesso', item: { tipo: 'automacao', id: x.automacao_id, nome: x.nome }, detalhes: { execucao: Number(x.numero) } }, db);
  });
  res.json({ ok: true });
}));

/** Execuções de um candidato (perfil lateral da Central). */
automacoesRouter.get('/candidato/:candidatoId', h(async (req, res) => {
  const id = parse(uuid, req.params.candidatoId);
  const minhas = filtroUnidades(req.usuario!);
  const { rows } = await pool.query(
    `SELECT x.id, x.numero, x.situacao, x.iniciada_em, x.finalizada_em, a.id AS automacao_id, a.nome
       FROM automacao_execucoes x JOIN automacoes a ON a.id = x.automacao_id JOIN candidatos c ON c.id = x.candidato_id
      WHERE x.candidato_id = $1 AND ($2::uuid[] IS NULL OR c.unidade_id = ANY($2))
      ORDER BY x.iniciada_em DESC LIMIT 30`,
    [id, minhas],
  );
  res.json(rows.map((x) => ({ id: x.id, numero: Number(x.numero), situacao: x.situacao, iniciadaEm: x.iniciada_em, finalizadaEm: x.finalizada_em, automacao: { id: x.automacao_id, nome: x.nome } })));
}));

