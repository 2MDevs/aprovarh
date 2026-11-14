import type { PoolClient } from 'pg';
import { auditar, type Ator } from '../../core/audit.ts';
import { publicar } from '../../core/tempoReal.ts';
import type { Db } from '../../db/pool.ts';
import { encrypt } from '../../lib/crypto.ts';
import { dataPorExtenso, datasEntre, instanteEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { badRequest, conflict, notFound } from '../../lib/http.ts';
import { recalcularLinhaDoTempo } from '../central/service.ts';

/**
 * Regras de entrevista, usadas pela Central (etapa 6), pelas respostas do WhatsApp (etapa 7)
 * e pelas automações (etapa 8). Nunca confirma um horário fora da disponibilidade ou sem vaga.
 */
export const ABERTAS = ['aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada'] as const;

export interface Origem { tipo: 'usuario' | 'automacao' | 'candidato'; usuarioId?: string | null; nome: string; ator: Ator; ip?: string | null }

export interface Horario {
  inicioEm: string; data: string; hora: string; vagas: number; ocupadas: number; livres: number;
  duracaoMinutos: number; disponibilidadeId: string; responsavelId: string | null; local: string | null;
}

/** Horários de uma unidade num intervalo de datas (YYYY-MM-DD), com vagas livres. Passado não entra. */
export async function horariosDaUnidade(db: Db, unidadeId: string, de: string, ate: string, ignorarEntrevistaId?: string): Promise<Horario[]> {
  const [disp, bloq, ocup] = await Promise.all([
    db.query(
      `SELECT id, to_char(data_inicial, 'YYYY-MM-DD') AS ini, to_char(data_final, 'YYYY-MM-DD') AS fim, dias_semana, horarios,
              duracao_minutos, vagas_por_horario, responsavel_id, local_texto
         FROM disponibilidades WHERE unidade_id = $1 AND ativa AND data_final >= $2::date AND data_inicial <= $3::date
        ORDER BY criada_em`,
      [unidadeId, de, ate],
    ),
    db.query<{ data: string }>(`SELECT to_char(data, 'YYYY-MM-DD') AS data FROM disponibilidade_bloqueios WHERE unidade_id = $1 AND data BETWEEN $2::date AND $3::date`, [unidadeId, de, ate]),
    db.query<{ inicio_em: Date; n: number }>(
      `SELECT inicio_em, count(*)::int AS n FROM entrevistas
        WHERE unidade_id = $1 AND situacao = ANY($2) AND inicio_em >= $3 AND inicio_em < $4 AND ($5::uuid IS NULL OR id <> $5)
        GROUP BY inicio_em`,
      [unidadeId, [...ABERTAS], instanteEmBrasilia(de, '00:00'), new Date(instanteEmBrasilia(ate, '00:00').getTime() + 86_400_000), ignorarEntrevistaId ?? null],
    ),
  ]);
  const bloqueadas = new Set(bloq.rows.map((b) => b.data));
  const ocupacao = new Map(ocup.rows.map((o) => [new Date(o.inicio_em).toISOString(), o.n]));
  const agora = Date.now();
  const vistos = new Map<string, Horario>();
  for (const d of disp.rows) {
    for (const data of datasEntre(d.ini > de ? d.ini : de, d.fim < ate ? d.fim : ate)) {
      if (bloqueadas.has(data)) continue;
      const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
      if (!(d.dias_semana as number[]).includes(diaSemana)) continue;
      for (const hora of d.horarios as string[]) {
        const inicio = instanteEmBrasilia(data, hora);
        if (inicio.getTime() <= agora) continue;
        const chave = inicio.toISOString();
        if (vistos.has(chave)) continue; // dois períodos com o mesmo horário: vale o primeiro cadastrado
        const ocupadas = ocupacao.get(chave) ?? 0;
        vistos.set(chave, {
          inicioEm: chave, data, hora, vagas: d.vagas_por_horario, ocupadas, livres: Math.max(0, d.vagas_por_horario - ocupadas),
          duracaoMinutos: d.duracao_minutos, disponibilidadeId: d.id, responsavelId: d.responsavel_id, local: d.local_texto,
        });
      }
    }
  }
  return [...vistos.values()].sort((a, b) => a.inicioEm.localeCompare(b.inicioEm));
}

/** Confere se o horário existe e tem vaga. Chamar com a trava da unidade já tomada. */
export async function conferirHorario(db: PoolClient, unidadeId: string, inicioEm: Date, ignorarEntrevistaId?: string): Promise<Horario> {
  const { data } = partesEmBrasilia(inicioEm);
  const h = (await horariosDaUnidade(db, unidadeId, data, data, ignorarEntrevistaId)).find((x) => x.inicioEm === inicioEm.toISOString());
  if (!h) throw badRequest('Esse horário não está na disponibilidade da unidade (ou já passou).', 'horario_indisponivel');
  if (h.livres < 1) throw conflict('Esse horário não tem mais vaga. Escolha outro.');
  return h;
}

/** Trava por unidade: dois agendamentos simultâneos não ultrapassam as vagas. */
const travarUnidade = (db: PoolClient, unidadeId: string) => db.query(`SELECT pg_advisory_xact_lock(hashtextextended('entrevistas:' || $1::text, 0))`, [unidadeId]);

async function evento(db: PoolClient, entrevistaId: string, tipo: string, o: Origem, extra: { motivo?: string | null; respostaOriginal?: string | null; dataInterpretada?: Date | null; aceita?: boolean | null } = {}) {
  await db.query(
    `INSERT INTO entrevista_eventos (entrevista_id, tipo, resposta_original, data_interpretada, aceita, motivo, autor_tipo, autor_usuario_id, autor_nome)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [entrevistaId, tipo, extra.respostaOriginal ? encrypt(extra.respostaOriginal) : null, extra.dataInterpretada ?? null, extra.aceita ?? null, extra.motivo ?? null,
      o.tipo, o.usuarioId ?? null, o.nome],
  );
}

/** Mensagem do sistema na conversa, visível ao candidato no portal. */
async function avisoNaConversa(db: PoolClient, candidatoId: string, texto: string) {
  const m = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, visivel_ao_candidato)
     SELECT id, 'saida', 'sistema', 'sistema', 'Sistema', $2, true FROM conversas WHERE candidato_id = $1 RETURNING id, criado_em`,
    [candidatoId, encrypt(texto)],
  );
  if (m.rows[0]) await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE candidato_id = $1', [candidatoId, m.rows[0].id, m.rows[0].criado_em]);
}

/** Muda o status do candidato pela chave do sistema (ex.: aguardando_entrevista), se ainda não estiver nele e o processo não estiver encerrado. */
async function moverStatus(db: PoolClient, candidatoId: string, chave: string, o: Origem, motivo: string) {
  const r = await db.query<{ atual: string; final: boolean; novo: string | null }>(
    `SELECT c.status_id AS atual, s.final, (SELECT id FROM status WHERE chave_sistema = $2 AND ativo) AS novo
       FROM candidatos c JOIN status s ON s.id = c.status_id WHERE c.id = $1`,
    [candidatoId, chave],
  );
  const x = r.rows[0];
  if (!x?.novo || x.final || x.atual === x.novo) return;
  await db.query('UPDATE candidatos SET status_id = $2 WHERE id = $1', [candidatoId, x.novo]);
  await db.query(
    `INSERT INTO status_historico (candidato_id, status_anterior_id, status_novo_id, autor_tipo, autor_usuario_id, autor_nome, motivo)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [candidatoId, x.atual, x.novo, o.tipo === 'candidato' ? 'sistema' : o.tipo, o.usuarioId ?? null, o.nome, motivo],
  );
  await recalcularLinhaDoTempo(db, candidatoId, x.novo);
}

async function finalizar(db: PoolClient, candidatoId: string, unidadeId: string, tipoEvento: string, dados: Record<string, unknown>) {
  await db.query('UPDATE candidatos SET ultima_interacao_em = now(), atualizado_em = now() WHERE id = $1', [candidatoId]);
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', [tipoEvento, candidatoId, JSON.stringify(dados)]);
  await publicar(db, { tipo: 'candidato.atualizado', candidatoId, unidadeId });
  await publicar(db, { tipo: 'mensagem.nova', candidatoId, unidadeId });
}

const descrever = (inicio: Date) => `${dataPorExtenso(inicio)}, às ${partesEmBrasilia(inicio).hora}`;

/** Agenda a entrevista (situação inicial: aguardando confirmação do candidato). */
export async function agendar(db: PoolClient, candidatoId: string, inicioEm: Date, o: Origem, responsavelId?: string | null) {
  const c = await db.query<{ unidade_id: string; codigo: string; unidade: string }>(
    `SELECT c.unidade_id, c.codigo, u.nome AS unidade FROM candidatos c JOIN unidades u ON u.id = c.unidade_id WHERE c.id = $1 AND c.excluido_em IS NULL FOR UPDATE OF c`,
    [candidatoId],
  );
  if (!c.rows[0]) throw notFound('Candidato não encontrado.');
  const { unidade_id: unidadeId, codigo, unidade } = c.rows[0];
  const aberta = await db.query('SELECT 1 FROM entrevistas WHERE candidato_id = $1 AND situacao = ANY($2)', [candidatoId, [...ABERTAS]]);
  if (aberta.rowCount) throw conflict('Este candidato já tem uma entrevista em aberto. Remarque ou cancele a atual.');
  await travarUnidade(db, unidadeId);
  const h = await conferirHorario(db, unidadeId, inicioEm);
  const r = await db.query<{ id: string }>(
    `INSERT INTO entrevistas (candidato_id, unidade_id, disponibilidade_id, inicio_em, duracao_minutos, responsavel_id, local_texto, criada_por_tipo, criada_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [candidatoId, unidadeId, h.disponibilidadeId, inicioEm, h.duracaoMinutos, responsavelId ?? h.responsavelId, h.local, o.tipo, o.usuarioId ?? null],
  );
  const id = r.rows[0].id;
  await evento(db, id, 'agendada', o);
  await moverStatus(db, candidatoId, 'aguardando_entrevista', o, 'Entrevista agendada');
  await avisoNaConversa(db, candidatoId, `Entrevista agendada para ${descrever(inicioEm)}, na unidade ${unidade}.${h.local ? ` Local: ${h.local}.` : ''}`);
  await auditar({ acao: 'entrevista.agendada', resultado: 'sucesso', item: { tipo: 'candidato', id: candidatoId, nome: codigo }, detalhes: { entrevistaId: id, inicioEm }, ator: o.ator, ip: o.ip }, db);
  await finalizar(db, candidatoId, unidadeId, 'entrevista.agendada', { entrevistaId: id, inicioEm });
  return id;
}

async function carregar(db: PoolClient, entrevistaId: string) {
  const r = await db.query(
    `SELECT e.*, c.codigo, c.unidade_id AS unidade_candidato FROM entrevistas e JOIN candidatos c ON c.id = e.candidato_id WHERE e.id = $1 FOR UPDATE OF e`,
    [entrevistaId],
  );
  if (!r.rows[0]) throw notFound('Entrevista não encontrada.');
  return r.rows[0];
}

type Acao = 'confirmar' | 'cancelar' | 'realizada' | 'nao_compareceu' | 'solicitar_remarcacao';
const REGRAS: Record<Acao, { de: string[]; para: string; evento: string; dominio: string; aviso?: (inicio: Date) => string }> = {
  confirmar: { de: ['aguardando_confirmacao', 'remarcacao_solicitada'], para: 'confirmada', evento: 'confirmada', dominio: 'entrevista.confirmada', aviso: (i) => `Entrevista confirmada para ${descrever(i)}.` },
  cancelar: { de: [...ABERTAS], para: 'cancelada', evento: 'cancelada', dominio: 'entrevista.cancelada', aviso: (i) => `A entrevista de ${descrever(i)} foi cancelada.` },
  solicitar_remarcacao: { de: ['aguardando_confirmacao', 'confirmada'], para: 'remarcacao_solicitada', evento: 'resposta_nao', dominio: 'entrevista.remarcacao_solicitada' },
  realizada: { de: ['confirmada', 'aguardando_confirmacao'], para: 'realizada', evento: 'realizada', dominio: 'entrevista.realizada' },
  nao_compareceu: { de: ['confirmada', 'aguardando_confirmacao'], para: 'nao_compareceu', evento: 'nao_compareceu', dominio: 'entrevista.nao_compareceu' },
};

export async function mudarSituacao(db: PoolClient, entrevistaId: string, acao: Acao, o: Origem, motivo?: string | null, respostaOriginal?: string | null) {
  const e = await carregar(db, entrevistaId);
  const regra = REGRAS[acao];
  if (!regra.de.includes(e.situacao)) throw conflict('A entrevista não está numa situação que permita isso.');
  const encerra = ['cancelada', 'realizada', 'nao_compareceu'].includes(regra.para);
  await db.query(
    `UPDATE entrevistas SET situacao = $2, motivo = COALESCE($3, motivo),
        confirmada_em = CASE WHEN $2 = 'confirmada' THEN now() ELSE confirmada_em END,
        encerrada_em = CASE WHEN $4 THEN now() ELSE encerrada_em END WHERE id = $1`,
    [entrevistaId, regra.para, motivo ?? null, encerra],
  );
  await evento(db, entrevistaId, regra.evento, o, { motivo, respostaOriginal, aceita: acao === 'confirmar' ? true : acao === 'solicitar_remarcacao' ? false : null });
  if (regra.aviso) await avisoNaConversa(db, e.candidato_id, regra.aviso(new Date(e.inicio_em)));
  await auditar({ acao: `entrevista.${regra.para}`, resultado: 'sucesso', item: { tipo: 'candidato', id: e.candidato_id, nome: e.codigo }, detalhes: { entrevistaId, motivo }, ator: o.ator, ip: o.ip }, db);
  await finalizar(db, e.candidato_id, e.unidade_candidato, regra.dominio, { entrevistaId });
}

/** Remarca: a entrevista atual vira "remarcada" e nasce outra no novo horário (conferido). */
export async function remarcar(db: PoolClient, entrevistaId: string, novoInicio: Date, o: Origem, motivo?: string | null, respostaOriginal?: string | null) {
  const e = await carregar(db, entrevistaId);
  if (!(ABERTAS as readonly string[]).includes(e.situacao)) throw conflict('Só é possível remarcar uma entrevista em aberto.');
  await travarUnidade(db, e.unidade_id);
  const h = await conferirHorario(db, e.unidade_id, novoInicio, entrevistaId);
  await db.query(`UPDATE entrevistas SET situacao = 'remarcada', encerrada_em = now(), motivo = COALESCE($2, motivo) WHERE id = $1`, [entrevistaId, motivo ?? null]);
  const r = await db.query<{ id: string }>(
    `INSERT INTO entrevistas (candidato_id, unidade_id, disponibilidade_id, inicio_em, duracao_minutos, responsavel_id, local_texto, criada_por_tipo, criada_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [e.candidato_id, e.unidade_id, h.disponibilidadeId, novoInicio, h.duracaoMinutos, e.responsavel_id ?? h.responsavelId, h.local, o.tipo, o.usuarioId ?? null],
  );
  await db.query('UPDATE entrevistas SET substituida_por = $2 WHERE id = $1', [entrevistaId, r.rows[0].id]);
  await evento(db, entrevistaId, 'remarcada', o, { motivo, respostaOriginal, dataInterpretada: novoInicio });
  await evento(db, r.rows[0].id, 'agendada', o, { motivo: 'Remarcação' });
  await avisoNaConversa(db, e.candidato_id, `Entrevista remarcada para ${descrever(novoInicio)}.${h.local ? ` Local: ${h.local}.` : ''}`);
  await auditar({ acao: 'entrevista.remarcada', resultado: 'sucesso', item: { tipo: 'candidato', id: e.candidato_id, nome: e.codigo }, detalhes: { de: e.inicio_em, para: novoInicio, novaEntrevistaId: r.rows[0].id }, ator: o.ator, ip: o.ip }, db);
  await finalizar(db, e.candidato_id, e.unidade_candidato, 'entrevista.agendada', { entrevistaId: r.rows[0].id, inicioEm: novoInicio, remarcacao: true });
  return r.rows[0].id;
}
