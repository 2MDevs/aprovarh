import type { PoolClient } from 'pg';
import { auditar } from '../../core/audit.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, transaction } from '../../db/pool.ts';
import { decrypt, encrypt, hmac } from '../../lib/crypto.ts';
import { type EventoEntrada } from './normalizar.ts';
import { tratarResposta } from './respostas.ts';

export { eventosEvolution, eventosMeta, type EventoEntrada } from './normalizar.ts';

/**
 * Entrada do WhatsApp (os dois provedores). O webhook só GUARDA o evento (cifrado, sem duplicar) e responde rápido;
 * o Worker processa depois. Se o processamento falhar, o evento fica guardado e é tentado de novo.
 */
/** Guarda os eventos do webhook (sem duplicar: a chave é o id da mensagem ou do status). */
export async function guardarEventos(eventos: EventoEntrada[]): Promise<number> {
  let novos = 0;
  for (const e of eventos) {
    const chave = e.tipo === 'mensagem' ? `msg:${e.id}` : `st:${e.id}:${e.situacao}`;
    const r = await pool.query(
      `INSERT INTO whatsapp_eventos_entrada (chave_dedup, tipo, carga) VALUES ($1, $2, $3) ON CONFLICT (chave_dedup) DO NOTHING`,
      [chave.slice(0, 200), e.tipo, encrypt(JSON.stringify(e))],
    );
    novos += r.rowCount ?? 0;
  }
  if (novos) await pool.query(`SELECT pg_notify('aprovarh_entrada_whatsapp', '')`);
  return novos;
}

const ORDEM = { pendente: 0, enviada: 1, entregue: 2, lida: 3, falhou: 4 } as const;

async function processarStatus(db: PoolClient, e: Extract<EventoEntrada, { tipo: 'status' }>) {
  const r = await db.query<{ id: string; situacao_entrega: keyof typeof ORDEM | null; candidato_id: string; unidade_id: string }>(
    `SELECT m.id, m.situacao_entrega, c.id AS candidato_id, c.unidade_id FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id JOIN candidatos c ON c.id = cv.candidato_id
      WHERE m.wamid = $1 FOR UPDATE OF m`,
    [e.id],
  );
  const m = r.rows[0];
  if (!m) return; // status de mensagem que não é do aprovaRH
  // Só avança (um "entregue" atrasado não desfaz um "lida").
  if (e.situacao !== 'falhou' && ORDEM[m.situacao_entrega ?? 'pendente'] >= ORDEM[e.situacao]) return;
  await db.query('UPDATE mensagens SET situacao_entrega = $2 WHERE id = $1', [m.id, e.situacao]);
  await publicar(db, { tipo: 'mensagem.nova', candidatoId: m.candidato_id, unidadeId: m.unidade_id });
}

async function processarMensagem(db: PoolClient, e: Extract<EventoEntrada, { tipo: 'mensagem' }>) {
  const telHash = hmac(`tel:${e.de}`);
  const c = await db.query<{ id: string; unidade_id: string; codigo: string; nome: string }>(
    `SELECT id, unidade_id, codigo, nome FROM candidatos WHERE telefone_hash = $1 AND excluido_em IS NULL ORDER BY candidatura_em DESC LIMIT 1`,
    [telHash],
  );
  const cand = c.rows[0];
  if (!cand) {
    // Número que não é de candidato: vai para "Contatos não identificados" e não cria candidato sozinho.
    await db.query(
      `INSERT INTO contatos_nao_identificados (telefone, telefone_hash, telefone_final, nome_perfil, ultima_mensagem)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (telefone_hash) DO UPDATE SET ultima_mensagem = EXCLUDED.ultima_mensagem, nome_perfil = COALESCE(EXCLUDED.nome_perfil, contatos_nao_identificados.nome_perfil),
         mensagens = contatos_nao_identificados.mensagens + 1, ultima_em = now(), arquivado_em = NULL`,
      [encrypt(e.de), telHash, e.de.slice(-4), e.nome?.slice(0, 160) ?? null, encrypt(e.texto.slice(0, 1000))],
    );
    return;
  }
  const cv = await db.query<{ id: string }>(
    `INSERT INTO conversas (candidato_id) VALUES ($1) ON CONFLICT (candidato_id) DO UPDATE SET candidato_id = EXCLUDED.candidato_id RETURNING id`,
    [cand.id],
  );
  const m = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, visivel_ao_candidato, wamid, criado_em)
     VALUES ($1, 'entrada', 'whatsapp', 'candidato', $2, $3, true, $4, $5)
     ON CONFLICT (wamid) DO NOTHING RETURNING id, criado_em`,
    [cv.rows[0].id, cand.nome, encrypt(e.texto), e.id, e.em],
  );
  if (!m.rows[0]) return; // já registrada
  // A mensagem do candidato abre a janela de 24 h (regra da Meta; na Evolution não há janela, mas o registro não atrapalha).
  await db.query(
    `UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3, janela_whatsapp_ate = GREATEST(COALESCE(janela_whatsapp_ate, $3), $3 + interval '24 hours') WHERE id = $1`,
    [cv.rows[0].id, m.rows[0].id, m.rows[0].criado_em],
  );
  await db.query('UPDATE candidatos SET ultima_interacao_em = now() WHERE id = $1', [cand.id]);
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['mensagem.recebida', cand.id, JSON.stringify({ mensagemId: m.rows[0].id, canal: 'whatsapp' })]);
  await auditar({ acao: 'mensagem.recebida', resultado: 'sucesso', item: { tipo: 'candidato', id: cand.id, nome: cand.codigo }, detalhes: { canal: 'whatsapp', mensagemId: m.rows[0].id }, ator: { usuarioNome: `Candidato ${cand.nome} (WhatsApp)` } }, db);
  await publicar(db, { tipo: 'mensagem.nova', candidatoId: cand.id, unidadeId: cand.unidade_id });
  // Respostas da entrevista (SIM / NÃO / data), se estiverem ligadas.
  await tratarResposta(db, cand.id, e.texto);
}

/** Rotina do Worker: processa os eventos guardados, um por transação. */
export async function processarEntradas(): Promise<number> {
  let feitos = 0;
  for (let i = 0; i < 50; i++) {
    const r = await pool.query<{ id: string; carga: string; tentativas: number }>(
      `SELECT id, carga, tentativas FROM whatsapp_eventos_entrada WHERE processado_em IS NULL ORDER BY id LIMIT 1`,
    );
    const ev = r.rows[0];
    if (!ev) break;
    try {
      await transaction(async (db) => {
        // Trava o evento: se dois Workers pegarem o mesmo, só um processa.
        const t = await db.query('SELECT 1 FROM whatsapp_eventos_entrada WHERE id = $1 AND processado_em IS NULL FOR UPDATE SKIP LOCKED', [ev.id]);
        if (!t.rowCount) return;
        const e = JSON.parse(decrypt(ev.carga)) as EventoEntrada;
        if (e.tipo === 'status') await processarStatus(db, e);
        else await processarMensagem(db, e);
        await db.query('UPDATE whatsapp_eventos_entrada SET processado_em = now(), erro = NULL WHERE id = $1', [ev.id]);
      });
      feitos++;
    } catch (err) {
      const tentativas = ev.tentativas + 1;
      console.error('[whatsapp] falha ao processar evento', ev.id, (err as Error).message);
      // Depois de 5 tentativas, sai da fila (fica guardado com o erro para análise).
      await pool.query(
        `UPDATE whatsapp_eventos_entrada SET tentativas = $2, erro = $3, processado_em = CASE WHEN $2 >= 5 THEN now() ELSE NULL END WHERE id = $1`,
        [ev.id, tentativas, (err as Error).message.slice(0, 500)],
      );
      if (tentativas < 5) break; // tenta de novo na próxima rodada
    }
  }
  return feitos;
}
