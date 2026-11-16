import { Router } from 'express';
import { z } from 'zod';
import { filtroUnidades } from '../../core/access.ts';
import { pool } from '../../db/pool.ts';
import { datasEntre, partesEmBrasilia } from '../../lib/datas.ts';
import { forbidden, h, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';

/**
 * Visão geral (seção 11 do prompt). Todo número sai do banco, nas unidades que a pessoa enxerga.
 * Nada é estimado nem preenchido: sem dados, o número é 0.
 */
export const painelRouter = Router();
painelRouter.use(exigirLogin(), exigirPermissao('dashboard.ver'));

const FUSO = `'America/Sao_Paulo'`;

painelRouter.get('/', h(async (req, res) => {
  const q = parse(z.object({ dias: z.coerce.number().int().refine((n) => [1, 7, 30, 90].includes(n)).default(30), unidadeId: z.string().uuid().optional() }), req.query);
  const minhas = filtroUnidades(req.usuario!);
  if (q.unidadeId && minhas && !minhas.includes(q.unidadeId)) throw forbidden('Você não tem acesso a essa unidade.');
  const un: string[] | null = q.unidadeId ? [q.unidadeId] : minhas;

  const hoje = partesEmBrasilia(new Date()).data;
  const inicio = datasEntre(new Date(Date.parse(`${hoje}T12:00:00Z`) - (q.dias - 1) * 86_400_000).toISOString().slice(0, 10), hoje);
  const desde = inicio[0];

  const [total, porStatus, novas, serie, porUnidade, entrevistas, proximas, aguardando, naoLidas, automacoes] = await Promise.all([
    pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM candidatos c WHERE c.excluido_em IS NULL AND ($1::uuid[] IS NULL OR c.unidade_id = ANY($1))`, [un]),
    pool.query<{ id: string; nome: string; cor: string; chave: string | null; final: boolean; n: number }>(
      `SELECT s.id, s.nome, s.cor, s.chave_sistema AS chave, s.final, count(c.id)::int AS n
         FROM status s LEFT JOIN candidatos c ON c.status_id = s.id AND c.excluido_em IS NULL AND ($1::uuid[] IS NULL OR c.unidade_id = ANY($1))
        WHERE s.ativo OR c.id IS NOT NULL GROUP BY s.id ORDER BY s.ordem, s.nome`,
      [un],
    ),
    // Novas candidaturas: primeira vez e reaberturas (reenvio de quem já está em andamento não conta como nova).
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM candidaturas k
        WHERE k.tipo IN ('nova', 'reaberta') AND (k.recebida_em AT TIME ZONE ${FUSO})::date >= $2::date AND ($1::uuid[] IS NULL OR k.unidade_id = ANY($1))`,
      [un, desde],
    ),
    pool.query<{ dia: string; n: number }>(
      `SELECT to_char((k.recebida_em AT TIME ZONE ${FUSO})::date, 'YYYY-MM-DD') AS dia, count(*)::int AS n FROM candidaturas k
        WHERE k.tipo IN ('nova', 'reaberta') AND (k.recebida_em AT TIME ZONE ${FUSO})::date >= $2::date AND ($1::uuid[] IS NULL OR k.unidade_id = ANY($1))
        GROUP BY 1`,
      [un, desde],
    ),
    pool.query<{ id: string; nome: string; total: number; em_andamento: number }>(
      `SELECT u.id, u.nome, count(c.id)::int AS total, count(c.id) FILTER (WHERE NOT s.final)::int AS em_andamento
         FROM unidades u LEFT JOIN candidatos c ON c.unidade_id = u.id AND c.excluido_em IS NULL LEFT JOIN status s ON s.id = c.status_id
        WHERE u.excluido_em IS NULL AND ($1::uuid[] IS NULL OR u.id = ANY($1))
        GROUP BY u.id ORDER BY count(c.id) DESC, u.nome`,
      [un],
    ),
    pool.query<{ situacao: string; n: number }>(
      `SELECT e.situacao, count(*)::int AS n FROM entrevistas e JOIN candidatos c ON c.id = e.candidato_id
        WHERE e.situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada') AND e.inicio_em >= now() AND c.excluido_em IS NULL
          AND ($1::uuid[] IS NULL OR e.unidade_id = ANY($1))
        GROUP BY e.situacao`,
      [un],
    ),
    pool.query<{ id: string; candidato_id: string; nome: string; unidade: string; inicio_em: Date; situacao: string }>(
      `SELECT e.id, c.id AS candidato_id, c.nome || ' ' || c.sobrenome AS nome, u.nome AS unidade, e.inicio_em, e.situacao
         FROM entrevistas e JOIN candidatos c ON c.id = e.candidato_id JOIN unidades u ON u.id = e.unidade_id
        WHERE e.situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada') AND e.inicio_em >= now() AND c.excluido_em IS NULL
          AND ($1::uuid[] IS NULL OR e.unidade_id = ANY($1))
        ORDER BY e.inicio_em LIMIT 6`,
      [un],
    ),
    // Aguardando resposta: a última mensagem da conversa é do candidato (a equipe ainda não respondeu). Decisão D38.
    pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM candidatos c JOIN status s ON s.id = c.status_id JOIN conversas cv ON cv.candidato_id = c.id
         JOIN mensagens m ON m.id = cv.ultima_mensagem_id
        WHERE c.excluido_em IS NULL AND NOT s.final AND m.autor_tipo = 'candidato' AND ($1::uuid[] IS NULL OR c.unidade_id = ANY($1))`,
      [un],
    ),
    // Não lidas por esta pessoa (mesma regra da lista de Conversas).
    pool.query<{ n: number; conversas: number }>(
      `SELECT COALESCE(sum(x.n), 0)::int AS n, count(*) FILTER (WHERE x.n > 0)::int AS conversas FROM (
         SELECT (SELECT count(*) FROM mensagens mm WHERE mm.conversa_id = cv.id AND mm.sentido = 'entrada' AND mm.criado_em > COALESCE(cl.lida_ate, '-infinity'::timestamptz)) AS n
           FROM candidatos c JOIN conversas cv ON cv.candidato_id = c.id
           LEFT JOIN conversa_leituras cl ON cl.conversa_id = cv.id AND cl.usuario_id = $2
          WHERE c.excluido_em IS NULL AND ($1::uuid[] IS NULL OR c.unidade_id = ANY($1))) x`,
      [un, req.usuario!.id],
    ),
    // Automações com erro: as que a pessoa enxerga (todas as unidades, ou só as dela).
    pool.query<{ automacoes: number; execucoes: number }>(
      `SELECT count(*) FILTER (WHERE a.situacao = 'com_erro')::int AS automacoes,
              COALESCE(sum((SELECT count(*) FROM automacao_execucoes x WHERE x.automacao_id = a.id AND x.situacao = 'com_erro')), 0)::int AS execucoes
         FROM automacoes a WHERE a.excluida_em IS NULL AND ($1::uuid[] IS NULL OR (a.unidades IS NOT NULL AND a.unidades <@ $1))`,
      [minhas],
    ),
  ]);

  const st = (chave: string) => porStatus.rows.find((s) => s.chave === chave)?.n ?? 0;
  const ent = Object.fromEntries(entrevistas.rows.map((r) => [r.situacao, r.n]));
  const porDia = new Map(serie.rows.map((r) => [r.dia, r.n]));
  res.json({
    dias: q.dias, desde, ate: hoje, atualizadoEm: new Date(),
    indicadores: {
      totalCandidatos: total.rows[0].n,
      novasCandidaturas: novas.rows[0].n,
      aguardandoEntrevista: st('aguardando_entrevista'),
      entrevistasAgendadas: (ent.aguardando_confirmacao ?? 0) + (ent.confirmada ?? 0) + (ent.remarcacao_solicitada ?? 0),
      preAprovados: st('pre_aprovado'),
      aprovados: st('aprovado'),
      reprovados: st('reprovado'),
      aguardandoResposta: aguardando.rows[0].n,
      mensagensNaoLidas: naoLidas.rows[0].n,
      conversasNaoLidas: naoLidas.rows[0].conversas,
      automacoesComErro: automacoes.rows[0].automacoes,
      execucoesComErro: automacoes.rows[0].execucoes,
    },
    entrevistas: { aguardandoConfirmacao: ent.aguardando_confirmacao ?? 0, confirmadas: ent.confirmada ?? 0, pediramOutraData: ent.remarcacao_solicitada ?? 0 },
    proximasEntrevistas: proximas.rows.map((e) => ({ id: e.id, candidatoId: e.candidato_id, nome: e.nome, unidade: e.unidade, inicioEm: e.inicio_em, situacao: e.situacao })),
    serie: inicio.map((dia) => ({ dia, n: porDia.get(dia) ?? 0 })),
    porUnidade: porUnidade.rows.map((u) => ({ id: u.id, nome: u.nome, total: u.total, emAndamento: u.em_andamento })),
    porStatus: porStatus.rows.map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, final: s.final, n: s.n })),
  });
}));
