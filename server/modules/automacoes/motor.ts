/**
 * Motor de automações (roda no Worker).
 * 1. Eventos de domínio → execuções (uma por automação ativa cujo gatilho aceita o evento).
 * 2. Execuções → passos, um por transação: o card e o registro do passo entram juntos ou não entram.
 * 3. Esperas → retomadas no horário, quando o candidato responde, ou por "Tempo esgotado".
 * 4. Gatilhos agendados → eventos com chave única (o mesmo disparo nunca se repete).
 * Proteções: chave única (versão + evento), uma execução ativa por automação e candidato, limite de passos,
 * limite de profundidade da cadeia de origem e nada roda se a automação não estiver ativa.
 */
import type { PoolClient } from 'pg';
import { CARD, CARDS, LIMITES, gatilhoDo, param, proximoNo, type Fluxo, type No } from '../../../shared/automacoes.ts';
import { auditar, type Ator } from '../../core/audit.ts';
import { cfg } from '../../core/settings.ts';
import { pool, transaction } from '../../db/pool.ts';
import { decrypt, encrypt } from '../../lib/crypto.ts';
import { instanteEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { HttpError } from '../../lib/http.ts';
import { interpretarSimNao, NAO_PADRAO, SIM_PADRAO } from '../../lib/interpretar.ts';
import { notificarGestoras } from '../publico/service.ts';
import { aplicarPatch, destino, ErroPasso, executarCard, RETOMAR, type Config, type Contexto } from './cards.ts';
import { carregarCandidato, efeitosReais, linkDoPortal } from './efeitos.ts';

const ATIVAS = ['ativa', 'com_erro'];
const ATOR_MOTOR: Ator = { usuarioNome: 'Motor de automações', perfil: 'Automação' };

// Versões publicadas não mudam: dá para guardar em memória para sempre.
const versoes = new Map<string, Fluxo>();
async function fluxoDaVersao(db: PoolClient | typeof pool, versaoId: string): Promise<Fluxo> {
  const guardado = versoes.get(versaoId);
  if (guardado) return guardado;
  const r = await db.query<{ fluxo: Fluxo }>('SELECT fluxo FROM automacao_versoes WHERE id = $1', [versaoId]);
  if (!r.rows[0]) throw new Error(`Versão ${versaoId} não encontrada`);
  versoes.set(versaoId, r.rows[0].fluxo);
  return r.rows[0].fluxo;
}

const lista = (v: string | null, padrao: string[]) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : padrao);
export async function configMotor(): Promise<Config> {
  return { sim: lista(await cfg('whatsapp.palavras_sim'), SIM_PADRAO), nao: lista(await cfg('whatsapp.palavras_nao'), NAO_PADRAO), link: linkDoPortal(), agora: new Date() };
}

const lerContexto = (v: string | null): Contexto => (v ? JSON.parse(decrypt(v)) : { evento: { tipo: '', dados: {} } });
const gravarContexto = (c: Contexto) => encrypt(JSON.stringify(c));

/** Gatilhos (tipos de card) que escutam cada tipo de evento. */
const GATILHOS_DO_EVENTO = new Map<string, string[]>();
for (const c of CARDS) for (const e of c.eventos ?? []) GATILHOS_DO_EVENTO.set(e, [...(GATILHOS_DO_EVENTO.get(e) ?? []), c.tipo]);

interface Evento { id: string; tipo: string; candidato_id: string | null; dados: Record<string, unknown>; cadeia_origem: string[] }
interface MensagemDoEvento { texto: string; canal: string }

async function mensagemDoEvento(db: PoolClient, ev: Evento): Promise<MensagemDoEvento | null> {
  if (ev.tipo !== 'mensagem.recebida' || !ev.dados.mensagemId) return null;
  const r = await db.query<{ texto: string | null; canal: string; autor_tipo: string }>('SELECT texto, canal, autor_tipo FROM mensagens WHERE id = $1', [ev.dados.mensagemId]);
  const m = r.rows[0];
  if (!m || m.autor_tipo !== 'candidato') return null;
  let texto = '';
  try { texto = m.texto ? decrypt(m.texto) : ''; } catch { /* chave trocada */ }
  return { texto, canal: m.canal };
}

/** O gatilho aceita este evento? (filtros do card) */
function gatilhoAceita(no: No, ev: Evento, versaoId: string, msg: MensagemDoEvento | null, palavras: { sim: string[]; nao: string[] }): boolean {
  const canalOk = (canal: string) => param(no, 'canal') === 'qualquer' || param(no, 'canal') === canal;
  switch (no.tipo) {
    case 'gatilho.candidato_cadastrado': return ev.tipo === 'candidato.cadastrado' || Boolean(param(no, 'incluirRepetidas'));
    case 'gatilho.mensagem_recebida': return Boolean(msg) && canalOk(msg!.canal);
    case 'gatilho.respondeu_sim': return Boolean(msg) && canalOk(msg!.canal) && interpretarSimNao(msg!.texto, palavras.sim, palavras.nao) === 'sim';
    case 'gatilho.respondeu_nao': return Boolean(msg) && canalOk(msg!.canal) && interpretarSimNao(msg!.texto, palavras.sim, palavras.nao) === 'nao';
    case 'gatilho.status_alterado': return !param(no, 'status') || ev.dados.para === param(no, 'status');
    case 'gatilho.tag_adicionada': return ev.dados.tagId === param(no, 'tag');
    case 'gatilho.entrevista_agendada': return !ev.dados.remarcacao || Boolean(param(no, 'incluirRemarcacoes'));
    case 'gatilho.data_entrevista': case 'gatilho.data_programada': case 'gatilho.horario_programado': return ev.dados.versaoId === versaoId;
    default: return true;
  }
}

// ═══════════════════════ 1. Eventos ═══════════════════════
export async function processarEventos(limite = 100): Promise<number> {
  let n = 0;
  const palavras = await configMotor();
  while (n < limite) {
    const fez = await transaction(async (db) => {
      const r = await db.query<Evento>(
        `SELECT id::text, tipo, candidato_id, dados, cadeia_origem FROM eventos_dominio WHERE processado_em IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const ev = r.rows[0];
      if (!ev) return false;
      if (ev.candidato_id) {
        const msg = await mensagemDoEvento(db, ev);
        if (msg) await resolverEsperasDeResposta(db, ev.candidato_id, msg);
        await iniciarExecucoes(db, ev, msg, palavras);
      }
      await db.query('UPDATE eventos_dominio SET processado_em = now() WHERE id = $1', [ev.id]);
      return true;
    });
    if (!fez) break;
    n++;
  }
  return n;
}

async function iniciarExecucoes(db: PoolClient, ev: Evento, msg: MensagemDoEvento | null, palavras: { sim: string[]; nao: string[] }) {
  const tipos = GATILHOS_DO_EVENTO.get(ev.tipo);
  if (!tipos) return;
  const autos = await db.query<{ id: string; nome: string; unidades: string[] | null; versao_id: string }>(
    `SELECT a.id, a.nome, a.unidades, v.id AS versao_id FROM automacoes a JOIN automacao_versoes v ON v.id = a.versao_publicada_id
      WHERE a.situacao = ANY($1) AND a.excluida_em IS NULL AND v.gatilho = ANY($2)`,
    [ATIVAS, tipos],
  );
  if (!autos.rowCount) return;
  // Proteção contra laço: cadeia longa demais não dispara mais nada.
  if (ev.cadeia_origem.length >= LIMITES.profundidadeCadeia) {
    await auditar({ acao: 'automacao.cadeia_interrompida', resultado: 'falha', item: { tipo: 'candidato', id: ev.candidato_id! }, detalhes: { evento: ev.tipo, cadeia: ev.cadeia_origem }, ator: ATOR_MOTOR }, db);
    return;
  }
  const cand = await carregarCandidato(db, ev.candidato_id!);
  if (!cand) return;
  for (const a of autos.rows) {
    if (ev.dados.automacaoId && ev.dados.automacaoId !== a.id) continue; // disparo agendado de outra automação
    if (a.unidades && !a.unidades.includes(cand.unidadeId)) continue;
    // Uma automação não se dispara a partir dela mesma.
    if (ev.cadeia_origem.length) {
      const propria = await db.query('SELECT 1 FROM automacao_execucoes WHERE id = ANY($1::uuid[]) AND automacao_id = $2', [ev.cadeia_origem, a.id]);
      if (propria.rowCount) continue;
    }
    const fluxo = await fluxoDaVersao(db, a.versao_id);
    const g = gatilhoDo(fluxo);
    if (!g || !gatilhoAceita(g, ev, a.versao_id, msg, palavras)) continue;
    const ctx: Contexto = { evento: { tipo: ev.tipo, dados: ev.dados } };
    if (msg && CARD[g.tipo]?.produz?.includes('resposta')) ctx.resposta = msg;
    // ON CONFLICT: o mesmo evento não cria duas execuções, e não começa outra se já houver uma ativa para o candidato.
    const ins = await db.query<{ id: string; numero: string }>(
      `INSERT INTO automacao_execucoes (automacao_id, versao_id, evento_id, candidato_id, no_atual, contexto, cadeia_origem)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id, numero::text`,
      [a.id, a.versao_id, ev.id, cand.id, g.id, gravarContexto(ctx), ev.cadeia_origem],
    );
    if (ins.rows[0]) {
      await auditar({ acao: 'automacao.execucao_iniciada', resultado: 'sucesso', item: { tipo: 'automacao', id: a.id, nome: a.nome }, detalhes: { execucao: Number(ins.rows[0].numero), candidatoId: cand.id, evento: ev.tipo }, ator: ATOR_MOTOR }, db);
    }
  }
}

// ═══════════════════════ 2. Esperas ═══════════════════════
async function continuarDepoisDaEspera(db: PoolClient, execucaoId: string, noId: string, saida: string, resumo: string, patch?: Partial<Contexto>) {
  const r = await db.query<{ versao_id: string; contexto: string | null; situacao: string; passos: number }>(
    'SELECT versao_id, contexto, situacao, passos FROM automacao_execucoes WHERE id = $1 FOR UPDATE', [execucaoId],
  );
  const x = r.rows[0];
  if (!x || x.situacao !== 'aguardando') return;
  const fluxo = await fluxoDaVersao(db, x.versao_id);
  const no = fluxo.nos.find((n) => n.id === noId);
  let ctx = aplicarPatch(lerContexto(x.contexto), patch);
  if (saida === RETOMAR) ctx = aplicarPatch(ctx, { retomando: noId });
  await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, saida, resumo) VALUES ($1, $2, $3, 'concluido', $4, $5)`,
    [execucaoId, noId, no?.tipo ?? '?', saida === RETOMAR ? null : saida, resumo]);
  const prox = !no ? null : saida === RETOMAR ? no : proximoNo(fluxo, noId, saida);
  if (prox) {
    await db.query(`UPDATE automacao_execucoes SET situacao = 'em_andamento', no_atual = $2, contexto = $3, proxima_tentativa_em = NULL, atualizada_em = now() WHERE id = $1`,
      [execucaoId, prox.id, gravarContexto(ctx)]);
  } else {
    await concluir(db, execucaoId);
  }
}

/** O candidato escreveu: resolve as esperas de resposta abertas dele (no canal combinado). */
async function resolverEsperasDeResposta(db: PoolClient, candidatoId: string, msg: MensagemDoEvento) {
  const r = await db.query<{ id: string; execucao_id: string; no_id: string }>(
    `SELECT w.id, w.execucao_id, w.no_id FROM automacao_esperas w
      WHERE w.candidato_id = $1 AND w.tipo = 'resposta' AND w.resolvida_em IS NULL AND (w.canal = 'qualquer' OR w.canal = $2)
      FOR UPDATE SKIP LOCKED`,
    [candidatoId, msg.canal],
  );
  for (const w of r.rows) {
    await db.query(`UPDATE automacao_esperas SET resolvida_em = now(), resolucao = 'resposta' WHERE id = $1`, [w.id]);
    await continuarDepoisDaEspera(db, w.execucao_id, w.no_id, 'respondeu', `Resposta recebida (${msg.canal === 'whatsapp' ? 'WhatsApp' : 'portal'}).`, { resposta: msg });
  }
}

export async function processarEsperas(limite = 100): Promise<number> {
  let n = 0;
  while (n < limite) {
    const fez = await transaction(async (db) => {
      const r = await db.query<{ id: string; execucao_id: string; no_id: string; tipo: string; saida_tempo: string }>(
        `SELECT id, execucao_id, no_id, tipo, saida_tempo FROM automacao_esperas
          WHERE resolvida_em IS NULL AND COALESCE(retomar_em, prazo_em) <= now() ORDER BY COALESCE(retomar_em, prazo_em) LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const w = r.rows[0];
      if (!w) return false;
      await db.query(`UPDATE automacao_esperas SET resolvida_em = now(), resolucao = 'tempo' WHERE id = $1`, [w.id]);
      await continuarDepoisDaEspera(db, w.execucao_id, w.no_id, w.saida_tempo, w.tipo === 'resposta' ? 'Tempo esgotado sem resposta.' : 'Espera concluída.');
      return true;
    });
    if (!fez) break;
    n++;
  }
  return n;
}

// ═══════════════════════ 3. Passos ═══════════════════════
async function concluir(db: PoolClient, execucaoId: string) {
  // O contexto pode ter dados pessoais (resposta do candidato): some no fim.
  const r = await db.query<{ automacao_id: string; numero: string; passos: number; nome: string }>(
    `UPDATE automacao_execucoes x SET situacao = 'concluida', contexto = NULL, finalizada_em = now(), atualizada_em = now()
       FROM automacoes a WHERE x.id = $1 AND a.id = x.automacao_id RETURNING x.automacao_id, x.numero::text, x.passos, a.nome`,
    [execucaoId],
  );
  const x = r.rows[0];
  if (x) await auditar({ acao: 'automacao.execucao_concluida', resultado: 'sucesso', item: { tipo: 'automacao', id: x.automacao_id, nome: x.nome }, detalhes: { execucao: Number(x.numero), passos: x.passos }, ator: ATOR_MOTOR }, db);
}

type Resultado = 'continua' | 'parou';

export async function rodarPasso(execucaoId: string): Promise<Resultado> {
  let noAtual: No | null = null;
  try {
    return await transaction(async (db) => {
      const r = await db.query<{
        id: string; numero: string; versao_id: string; candidato_id: string; no_atual: string; contexto: string | null; cadeia_origem: string[];
        passos: number; nome: string; a_situacao: string;
      }>(
        `SELECT x.id, x.numero::text, x.versao_id, x.candidato_id, x.no_atual, x.contexto, x.cadeia_origem, x.passos, a.nome, a.situacao AS a_situacao
           FROM automacao_execucoes x JOIN automacoes a ON a.id = x.automacao_id
          WHERE x.id = $1 AND x.situacao = 'em_andamento' FOR UPDATE OF x SKIP LOCKED`,
        [execucaoId],
      );
      const x = r.rows[0];
      if (!x) return 'parou';
      if (!ATIVAS.includes(x.a_situacao)) return 'parou'; // pausada: fica parada até ativarem de novo
      if (x.passos >= LIMITES.passosPorExecucao) {
        await encerrar(db, x.id, `Interrompida: passou do limite de ${LIMITES.passosPorExecucao} passos.`);
        return 'parou';
      }
      const fluxo = await fluxoDaVersao(db, x.versao_id);
      const no = fluxo.nos.find((n) => n.id === x.no_atual);
      noAtual = no ?? null;
      if (!no) {
        await concluir(db, x.id);
        return 'parou';
      }
      const cand = await carregarCandidato(db, x.candidato_id);
      if (!cand) {
        await encerrar(db, x.id, 'Interrompida: o candidato foi excluído.');
        return 'parou';
      }
      // Eventos criados neste passo carregam a cadeia (proteção contra laço entre automações).
      await db.query(`SELECT set_config('aprovarh.cadeia', $1, true)`, [[...x.cadeia_origem, x.id].join(',')]);

      let ctx = lerContexto(x.contexto);
      const passo = x.passos + 1;
      const res = await executarCard(no, ctx, cand, efeitosReais(db, cand, { id: x.id, numero: Number(x.numero), automacaoNome: x.nome, passo }), await configMotor());
      ctx = aplicarPatch(ctx, res.patch);

      if (res.esperar) {
        const e = res.esperar;
        await db.query(
          `INSERT INTO automacao_esperas (execucao_id, candidato_id, no_id, tipo, retomar_em, prazo_em, saida_tempo, canal) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          e.tipo === 'tempo'
            ? [x.id, cand.id, no.id, 'tempo', e.ate, null, e.saida, null]
            : [x.id, cand.id, no.id, 'resposta', null, e.prazo, 'tempo_esgotado', e.canal],
        );
        await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, resumo) VALUES ($1, $2, $3, 'aguardando', $4)`, [x.id, no.id, no.tipo, res.resumo]);
        await db.query(`UPDATE automacao_execucoes SET situacao = 'aguardando', contexto = $2, passos = $3, tentativas_no = 0, proxima_tentativa_em = NULL, atualizada_em = now() WHERE id = $1`,
          [x.id, gravarContexto(ctx), passo]);
        return 'parou';
      }

      const prox = destino(fluxo, no, res);
      await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, saida, resumo) VALUES ($1, $2, $3, 'concluido', $4, $5)`,
        [x.id, no.id, no.tipo, res.irPara ? 'repetir' : res.saida ?? null, res.resumo]);
      if (prox) {
        await db.query(`UPDATE automacao_execucoes SET no_atual = $2, contexto = $3, passos = $4, tentativas_no = 0, proxima_tentativa_em = NULL, erro = NULL, atualizada_em = now() WHERE id = $1`,
          [x.id, prox.id, gravarContexto(ctx), passo]);
        return 'continua';
      }
      await db.query('UPDATE automacao_execucoes SET passos = $2 WHERE id = $1', [x.id, passo]);
      await concluir(db, x.id);
      return 'parou';
    });
  } catch (err) {
    await registrarFalha(execucaoId, noAtual, err);
    return 'parou';
  }
}

/** Falha no passo: tenta de novo se for temporária; senão, a execução fica "Com erro" e a gestora é avisada. */
async function registrarFalha(execucaoId: string, no: No | null, err: unknown) {
  const definitivo = (err instanceof ErroPasso && !err.temporario) || (err instanceof HttpError && err.status < 500);
  const mensagem = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  if (!(err instanceof ErroPasso) && !(err instanceof HttpError)) console.error('[automacoes] passo falhou', execucaoId, err);
  await transaction(async (db) => {
    const r = await db.query<{ tentativas_no: number; automacao_id: string; nome: string; candidato_id: string; unidade_id: string; numero: string; no_atual: string }>(
      `SELECT x.tentativas_no, x.automacao_id, a.nome, x.candidato_id, c.unidade_id, x.numero::text, x.no_atual
         FROM automacao_execucoes x JOIN automacoes a ON a.id = x.automacao_id JOIN candidatos c ON c.id = x.candidato_id
        WHERE x.id = $1 AND x.situacao = 'em_andamento' FOR UPDATE OF x`,
      [execucaoId],
    );
    const x = r.rows[0];
    if (!x) return;
    const tentativa = x.tentativas_no + 1;
    const maximo = definitivo ? 1 : Math.max(CARD[no?.tipo ?? '']?.tentativas ?? 3, 3);
    await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, erro, tentativa) VALUES ($1, $2, $3, 'erro', $4, $5)`,
      [execucaoId, no?.id ?? x.no_atual, no?.tipo ?? '?', mensagem, tentativa]);
    if (tentativa < maximo) {
      await db.query(`UPDATE automacao_execucoes SET tentativas_no = $2, proxima_tentativa_em = now() + make_interval(mins => $3), atualizada_em = now() WHERE id = $1`,
        [execucaoId, tentativa, 2 ** tentativa]);
      return;
    }
    await db.query(`UPDATE automacao_execucoes SET situacao = 'com_erro', erro = $2, tentativas_no = $3, atualizada_em = now() WHERE id = $1`, [execucaoId, mensagem, tentativa]);
    await db.query(`UPDATE automacoes SET situacao = 'com_erro' WHERE id = $1 AND situacao = 'ativa'`, [x.automacao_id]);
    await notificarGestoras(db, x.unidade_id, 'Automação com erro', `"${x.nome}" parou na execução nº ${x.numero}: ${mensagem}`.slice(0, 500), `/automacoes/${x.automacao_id}?execucao=${execucaoId}`);
    await auditar({ acao: 'automacao.execucao_com_erro', resultado: 'falha', item: { tipo: 'automacao', id: x.automacao_id, nome: x.nome }, detalhes: { execucao: Number(x.numero), erro: mensagem }, ator: ATOR_MOTOR }, db);
  });
}

/** Encerra (limite de passos, candidato excluído ou pedido de alguém). */
export async function encerrar(db: PoolClient, execucaoId: string, motivo: string, usuarioId?: string | null) {
  await db.query(`UPDATE automacao_esperas SET resolvida_em = now(), resolucao = 'interrompida' WHERE execucao_id = $1 AND resolvida_em IS NULL`, [execucaoId]);
  const r = await db.query<{ no_atual: string | null }>(
    `UPDATE automacao_execucoes SET situacao = 'interrompida', contexto = NULL, erro = $2, interrompida_por = $3, finalizada_em = now(), atualizada_em = now()
      WHERE id = $1 RETURNING no_atual`,
    [execucaoId, motivo.slice(0, 500), usuarioId ?? null],
  );
  await db.query(`INSERT INTO automacao_passos (execucao_id, no_id, tipo_card, situacao, resumo) VALUES ($1, $2, '-', 'concluido', $3)`, [execucaoId, r.rows[0]?.no_atual ?? '-', motivo.slice(0, 500)]);
}

export async function processarExecucoes(limite = 20): Promise<number> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM automacao_execucoes WHERE situacao = 'em_andamento' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= now()) ORDER BY atualizada_em LIMIT $1`,
    [limite],
  );
  let passos = 0;
  for (const { id } of r.rows) {
    for (let i = 0; i < 25; i++) {
      passos++;
      if ((await rodarPasso(id)) !== 'continua') break;
    }
  }
  return passos;
}

// ═══════════════════════ 4. Gatilhos agendados ═══════════════════════
export async function agendarDisparos(): Promise<number> {
  const autos = await pool.query<{ id: string; unidades: string[] | null; versao_id: string; fluxo: Fluxo }>(
    `SELECT a.id, a.unidades, v.id AS versao_id, v.fluxo FROM automacoes a JOIN automacao_versoes v ON v.id = a.versao_publicada_id
      WHERE a.situacao = ANY($1) AND a.excluida_em IS NULL AND v.gatilho IN ('gatilho.data_entrevista', 'gatilho.data_programada', 'gatilho.horario_programado')`,
    [ATIVAS],
  );
  const agora = new Date();
  const { data: hoje, hora: agoraHora, diaSemana } = partesEmBrasilia(agora);
  let total = 0;
  for (const a of autos.rows) {
    const g = gatilhoDo(a.fluxo);
    if (!g) continue;
    const dados = `jsonb_build_object('automacaoId', $1::text, 'versaoId', $2::text)`;
    let r;
    if (g.tipo === 'gatilho.data_entrevista') {
      if (agoraHora < String(param(g, 'hora'))) continue;
      r = await pool.query(
        `INSERT INTO eventos_dominio (tipo, candidato_id, dados, chave_unica)
         SELECT 'agenda.disparo', e.candidato_id, ${dados} || jsonb_build_object('entrevistaId', e.id), 'agenda:' || $2 || ':' || e.id || ':' || to_char(e.inicio_em, 'YYYYMMDDHH24MI')
           FROM entrevistas e JOIN candidatos c ON c.id = e.candidato_id
          WHERE e.situacao IN ('aguardando_confirmacao', 'confirmada') AND c.excluido_em IS NULL AND e.inicio_em > now()
            AND ($3::uuid[] IS NULL OR c.unidade_id = ANY($3))
            AND (e.inicio_em AT TIME ZONE 'America/Sao_Paulo')::date - $4::int = $5::date
         ON CONFLICT (chave_unica) WHERE chave_unica IS NOT NULL DO NOTHING`,
        [a.id, a.versao_id, a.unidades, Number(param(g, 'diasAntes') ?? 0), hoje],
      );
    } else {
      let sufixo = ''; // data programada: uma vez por candidato; horário programado: uma vez por dia
      if (g.tipo === 'gatilho.data_programada') {
        const quando = instanteEmBrasilia(String(param(g, 'data')), String(param(g, 'hora')));
        // Dispara uma vez; se o Worker esteve parado, ainda vale até 24 h depois do horário.
        if (agora < quando || agora.getTime() - quando.getTime() > 86_400_000) continue;
      } else {
        const dias = (param<number[]>(g, 'dias') ?? []).map(Number);
        const hora = String(param(g, 'hora'));
        // Janela de 2 h depois do horário: ativar a automação à tarde não dispara o horário da manhã.
        const limite = partesEmBrasilia(instanteEmBrasilia(hoje, hora).getTime() + 2 * 3_600_000).hora;
        if (!dias.includes(diaSemana) || agoraHora < hora || (limite > hora && agoraHora > limite)) continue;
        sufixo = `${hoje}:`;
      }
      r = await pool.query(
        `INSERT INTO eventos_dominio (tipo, candidato_id, dados, chave_unica)
         SELECT 'agenda.disparo', c.id, ${dados}, 'agenda:' || $2 || ':' || $6::text || c.id
           FROM candidatos c
          WHERE c.excluido_em IS NULL AND c.status_id = ANY($4::uuid[])
            AND ($3::uuid[] IS NULL OR c.unidade_id = ANY($3))
            AND ($5::uuid IS NULL OR EXISTS (SELECT 1 FROM candidato_tags t WHERE t.candidato_id = c.id AND t.tag_id = $5))
          LIMIT 500
         ON CONFLICT (chave_unica) WHERE chave_unica IS NOT NULL DO NOTHING`,
        [a.id, a.versao_id, a.unidades, param<string[]>(g, 'status') ?? [], param(g, 'tag') || null, sufixo],
      );
    }
    total += r.rowCount ?? 0;
  }
  return total;
}
