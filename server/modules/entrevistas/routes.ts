import { Router } from 'express';
import { z } from 'zod';
import { enxergaUnidade, filtroUnidades } from '../../core/access.ts';
import { auditarReq } from '../../core/audit.ts';
import { pool, transaction } from '../../db/pool.ts';
import { diaEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { badRequest, forbidden, h, ipDe, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { candidatoVisivel } from '../central/service.ts';
import { agendar, ABERTAS, horariosDaUnidade, mudarSituacao, remarcar, type Origem } from './servico.ts';

/** Entrevistas: disponibilidade das unidades, horários livres, agenda e ações sobre cada entrevista. */
export const entrevistasRouter = Router();
entrevistasRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'));

const uuid = z.string().uuid();
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido (use HH:MM).');

const origemDe = (req: Express.Request): Origem => ({
  tipo: 'usuario', usuarioId: req.usuario!.id, nome: req.usuario!.nome, ip: ipDe(req as never),
  ator: { usuarioId: req.usuario!.id, usuarioNome: req.usuario!.nome, perfil: req.usuario!.perfilNome, setor: req.usuario!.setor },
});

function exigirUnidade(req: Express.Request, unidadeId: string) {
  if (!enxergaUnidade(req.usuario!, unidadeId)) throw forbidden('Você não tem acesso a esta unidade.');
}

// ── Disponibilidade ────────────────────────────────────────────────────────
entrevistasRouter.get('/disponibilidades', h(async (req, res) => {
  const { unidadeId } = parse(z.object({ unidadeId: uuid.optional() }), req.query);
  if (unidadeId) exigirUnidade(req, unidadeId);
  const { rows } = await pool.query(
    `SELECT d.id, d.unidade_id, u.nome AS unidade, to_char(d.data_inicial, 'YYYY-MM-DD') AS data_inicial, to_char(d.data_final, 'YYYY-MM-DD') AS data_final,
            d.dias_semana, d.horarios, d.duracao_minutos, d.vagas_por_horario, d.responsavel_id, r.nome AS responsavel, d.local_texto, d.ativa
       FROM disponibilidades d JOIN unidades u ON u.id = d.unidade_id LEFT JOIN usuarios r ON r.id = d.responsavel_id
      WHERE d.ativa AND ($1::uuid IS NULL OR d.unidade_id = $1) AND ($2::uuid[] IS NULL OR d.unidade_id = ANY($2))
      ORDER BY u.nome, d.data_inicial`,
    [unidadeId ?? null, filtroUnidades(req.usuario!)],
  );
  res.json(rows.map((d) => ({
    id: d.id, unidade: { id: d.unidade_id, nome: d.unidade }, dataInicial: d.data_inicial, dataFinal: d.data_final, diasSemana: d.dias_semana,
    horarios: d.horarios, duracaoMinutos: d.duracao_minutos, vagasPorHorario: d.vagas_por_horario,
    responsavel: d.responsavel_id ? { id: d.responsavel_id, nome: d.responsavel } : null, local: d.local_texto,
  })));
}));

const dadosDisp = z.object({
  unidadeId: uuid,
  dataInicial: dia,
  dataFinal: dia,
  diasSemana: z.array(z.number().int().min(0).max(6)).min(1, 'Escolha pelo menos um dia da semana.').max(7),
  horarios: z.array(hhmm).min(1, 'Informe pelo menos um horário.').max(48),
  duracaoMinutos: z.number().int().min(5).max(480),
  vagasPorHorario: z.number().int().min(1).max(50),
  responsavelId: uuid.nullable().optional(),
  local: z.string().trim().max(255).nullable().optional(),
}).refine((d) => d.dataFinal >= d.dataInicial, 'A data final precisa ser igual ou depois da inicial.');

async function conferirResponsavel(id: string | null | undefined) {
  if (!id) return;
  const r = await pool.query(`SELECT 1 FROM usuarios WHERE id = $1 AND excluido_em IS NULL AND situacao = 'ativo'`, [id]);
  if (!r.rowCount) throw badRequest('Responsável não encontrado.');
}

entrevistasRouter.post('/disponibilidades', exigirPermissao('disponibilidade.configurar'), h(async (req, res) => {
  const b = parse(dadosDisp, req.body);
  exigirUnidade(req, b.unidadeId);
  await conferirResponsavel(b.responsavelId);
  const horarios = [...new Set(b.horarios)].sort();
  const r = await pool.query<{ id: string }>(
    `INSERT INTO disponibilidades (unidade_id, data_inicial, data_final, dias_semana, horarios, duracao_minutos, vagas_por_horario, responsavel_id, local_texto, criada_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [b.unidadeId, b.dataInicial, b.dataFinal, [...new Set(b.diasSemana)], horarios, b.duracaoMinutos, b.vagasPorHorario, b.responsavelId ?? null, b.local || null, req.usuario!.id],
  );
  await auditarReq(req, { acao: 'disponibilidade.criada', resultado: 'sucesso', item: { tipo: 'disponibilidade', id: r.rows[0].id }, detalhes: { ...b, horarios } });
  res.status(201).json({ id: r.rows[0].id });
}));

entrevistasRouter.put('/disponibilidades/:id', exigirPermissao('disponibilidade.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(dadosDisp, req.body);
  exigirUnidade(req, b.unidadeId);
  await conferirResponsavel(b.responsavelId);
  const atual = await pool.query<{ unidade_id: string }>('SELECT unidade_id FROM disponibilidades WHERE id = $1 AND ativa', [id]);
  if (!atual.rows[0]) throw notFound('Período não encontrado.');
  exigirUnidade(req, atual.rows[0].unidade_id);
  // Entrevistas já marcadas continuam valendo mesmo que o período mude (a regra vale para os próximos agendamentos).
  await pool.query(
    `UPDATE disponibilidades SET unidade_id = $2, data_inicial = $3, data_final = $4, dias_semana = $5, horarios = $6, duracao_minutos = $7,
        vagas_por_horario = $8, responsavel_id = $9, local_texto = $10, atualizada_em = now() WHERE id = $1`,
    [id, b.unidadeId, b.dataInicial, b.dataFinal, [...new Set(b.diasSemana)], [...new Set(b.horarios)].sort(), b.duracaoMinutos, b.vagasPorHorario, b.responsavelId ?? null, b.local || null],
  );
  await auditarReq(req, { acao: 'disponibilidade.alterada', resultado: 'sucesso', item: { tipo: 'disponibilidade', id }, detalhes: b });
  res.json({ ok: true });
}));

entrevistasRouter.delete('/disponibilidades/:id', exigirPermissao('disponibilidade.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const r = await pool.query<{ unidade_id: string }>('SELECT unidade_id FROM disponibilidades WHERE id = $1 AND ativa', [id]);
  if (!r.rows[0]) throw notFound('Período não encontrado.');
  exigirUnidade(req, r.rows[0].unidade_id);
  // Entrevistas já marcadas neste período continuam valendo.
  await pool.query('UPDATE disponibilidades SET ativa = false, atualizada_em = now() WHERE id = $1', [id]);
  await auditarReq(req, { acao: 'disponibilidade.excluida', resultado: 'sucesso', item: { tipo: 'disponibilidade', id } });
  res.json({ ok: true });
}));

/** Pessoas que podem ser responsáveis por entrevistas (quem atende candidatos). */
entrevistasRouter.get('/responsaveis', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
      WHERE u.excluido_em IS NULL AND u.situacao = 'ativo' AND ('candidatos.ver' = ANY(p.permissoes) OR p.chave = 'desenvolvedor') AND NOT u.admin_inicial
      ORDER BY u.nome`,
  );
  res.json(rows);
}));

// ── Bloqueios (feriados, folgas) ───────────────────────────────────────────
entrevistasRouter.get('/bloqueios', h(async (req, res) => {
  const { unidadeId } = parse(z.object({ unidadeId: uuid }), req.query);
  exigirUnidade(req, unidadeId);
  const { rows } = await pool.query(`SELECT id, to_char(data, 'YYYY-MM-DD') AS data, motivo FROM disponibilidade_bloqueios WHERE unidade_id = $1 AND data >= current_date - 30 ORDER BY data`, [unidadeId]);
  res.json(rows);
}));

entrevistasRouter.post('/bloqueios', exigirPermissao('disponibilidade.configurar'), h(async (req, res) => {
  const b = parse(z.object({ unidadeId: uuid, data: dia, motivo: z.string().trim().max(120).optional() }), req.body);
  exigirUnidade(req, b.unidadeId);
  await pool.query(`INSERT INTO disponibilidade_bloqueios (unidade_id, data, motivo, criado_por) VALUES ($1, $2, $3, $4) ON CONFLICT (unidade_id, data) DO UPDATE SET motivo = EXCLUDED.motivo`, [b.unidadeId, b.data, b.motivo ?? null, req.usuario!.id]);
  await auditarReq(req, { acao: 'disponibilidade.bloqueio_criado', resultado: 'sucesso', item: { tipo: 'unidade', id: b.unidadeId }, detalhes: b });
  res.status(201).json({ ok: true });
}));

entrevistasRouter.delete('/bloqueios/:id', exigirPermissao('disponibilidade.configurar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const r = await pool.query<{ unidade_id: string }>('SELECT unidade_id FROM disponibilidade_bloqueios WHERE id = $1', [id]);
  if (!r.rows[0]) throw notFound('Bloqueio não encontrado.');
  exigirUnidade(req, r.rows[0].unidade_id);
  await pool.query('DELETE FROM disponibilidade_bloqueios WHERE id = $1', [id]);
  await auditarReq(req, { acao: 'disponibilidade.bloqueio_removido', resultado: 'sucesso', item: { tipo: 'unidade', id: r.rows[0].unidade_id } });
  res.json({ ok: true });
}));

// ── Horários livres ────────────────────────────────────────────────────────
entrevistasRouter.get('/horarios', h(async (req, res) => {
  const hoje = diaEmBrasilia();
  const hojeTxt = `${hoje.ano}-${String(hoje.mes).padStart(2, '0')}-${String(hoje.dia).padStart(2, '0')}`;
  const q = parse(z.object({ unidadeId: uuid, de: dia.optional(), ate: dia.optional(), ignorar: uuid.optional() }), req.query);
  exigirUnidade(req, q.unidadeId);
  const de = q.de && q.de > hojeTxt ? q.de : hojeTxt;
  const ate = q.ate ?? partesEmBrasilia(Date.now() + 60 * 86_400_000).data;
  if (ate < de) return res.json([]);
  if (Date.parse(ate) - Date.parse(de) > 120 * 86_400_000) throw badRequest('Consulte no máximo 120 dias por vez.');
  res.json(await horariosDaUnidade(pool, q.unidadeId, de, ate, q.ignorar));
}));

// ── Agenda ─────────────────────────────────────────────────────────────────
entrevistasRouter.get('/', h(async (req, res) => {
  const q = parse(z.object({ unidadeId: uuid.optional(), de: dia, ate: dia, situacao: z.string().max(30).optional() }), req.query);
  if (q.unidadeId) exigirUnidade(req, q.unidadeId);
  const { rows } = await pool.query(
    `SELECT e.id, e.inicio_em, e.duracao_minutos, e.situacao, e.local_texto, e.confirmada_em, e.unidade_id, u.nome AS unidade,
            c.id AS candidato_id, c.nome || ' ' || c.sobrenome AS candidato, c.codigo, c.foto_id, r.nome AS responsavel
       FROM entrevistas e JOIN candidatos c ON c.id = e.candidato_id JOIN unidades u ON u.id = e.unidade_id LEFT JOIN usuarios r ON r.id = e.responsavel_id
      WHERE c.excluido_em IS NULL AND e.inicio_em >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND e.inicio_em < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND ($3::uuid IS NULL OR e.unidade_id = $3) AND ($4::uuid[] IS NULL OR e.unidade_id = ANY($4))
        AND ($5::text IS NULL OR e.situacao = $5) AND e.situacao <> 'remarcada'
      ORDER BY e.inicio_em`,
    [q.de, q.ate, q.unidadeId ?? null, filtroUnidades(req.usuario!), q.situacao ?? null],
  );
  res.json(rows.map((e) => ({
    id: e.id, inicioEm: e.inicio_em, duracaoMinutos: e.duracao_minutos, situacao: e.situacao, local: e.local_texto, confirmadaEm: e.confirmada_em,
    unidade: { id: e.unidade_id, nome: e.unidade }, responsavel: e.responsavel,
    candidato: { id: e.candidato_id, nome: e.candidato, codigo: e.codigo, fotoId: e.foto_id },
  })));
}));

/** Entrevistas de um candidato (perfil lateral). */
entrevistasRouter.get('/candidato/:id', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await candidatoVisivel(req.usuario!, id);
  const { rows } = await pool.query(
    `SELECT e.id, e.inicio_em, e.duracao_minutos, e.situacao, e.local_texto, e.motivo, e.confirmada_em, e.criada_em, e.unidade_id, u.nome AS unidade, r.nome AS responsavel,
            COALESCE((SELECT json_agg(json_build_object('tipo', ev.tipo, 'em', ev.em, 'autor', ev.autor_nome, 'motivo', ev.motivo) ORDER BY ev.em)
                        FROM entrevista_eventos ev WHERE ev.entrevista_id = e.id), '[]') AS eventos
       FROM entrevistas e JOIN unidades u ON u.id = e.unidade_id LEFT JOIN usuarios r ON r.id = e.responsavel_id
      WHERE e.candidato_id = $1 ORDER BY e.inicio_em DESC`,
    [id],
  );
  res.json(rows.map((e) => ({
    id: e.id, inicioEm: e.inicio_em, duracaoMinutos: e.duracao_minutos, situacao: e.situacao, local: e.local_texto, motivo: e.motivo,
    confirmadaEm: e.confirmada_em, unidade: { id: e.unidade_id, nome: e.unidade }, responsavel: e.responsavel, eventos: e.eventos,
    aberta: (ABERTAS as readonly string[]).includes(e.situacao),
  })));
}));

entrevistasRouter.post('/candidato/:id', exigirPermissao('entrevistas.agendar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ inicioEm: z.string().datetime({ offset: true }), responsavelId: uuid.nullable().optional() }), req.body);
  await candidatoVisivel(req.usuario!, id);
  const entrevistaId = await transaction((db) => agendar(db, id, new Date(b.inicioEm), origemDe(req), b.responsavelId));
  res.status(201).json({ id: entrevistaId });
}));

async function conferirEntrevista(req: Express.Request, entrevistaId: string) {
  const r = await pool.query<{ candidato_id: string }>('SELECT candidato_id FROM entrevistas WHERE id = $1', [entrevistaId]);
  if (!r.rows[0]) throw notFound('Entrevista não encontrada.');
  await candidatoVisivel(req.usuario!, r.rows[0].candidato_id); // escopo de unidade
}

const ACOES = { confirmar: 'confirmar', cancelar: 'cancelar', realizada: 'realizada', 'nao-compareceu': 'nao_compareceu' } as const;
for (const [rota, acao] of Object.entries(ACOES)) {
  entrevistasRouter.post(`/:id/${rota}`, exigirPermissao('entrevistas.agendar'), h(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { motivo } = parse(z.object({ motivo: z.string().trim().max(255).optional() }), req.body ?? {});
    await conferirEntrevista(req, id);
    await transaction((db) => mudarSituacao(db, id, acao, origemDe(req), motivo));
    res.json({ ok: true });
  }));
}

entrevistasRouter.post('/:id/remarcar', exigirPermissao('entrevistas.agendar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ inicioEm: z.string().datetime({ offset: true }), motivo: z.string().trim().max(255).optional() }), req.body);
  await conferirEntrevista(req, id);
  const nova = await transaction((db) => remarcar(db, id, new Date(b.inicioEm), origemDe(req), b.motivo));
  res.json({ id: nova });
}));
