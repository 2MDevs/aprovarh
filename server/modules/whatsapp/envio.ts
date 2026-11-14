import type { PoolClient } from 'pg';
import { cfgNumero } from '../../core/settings.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool } from '../../db/pool.ts';
import { decrypt, encrypt } from '../../lib/crypto.ts';
import { badRequest } from '../../lib/http.ts';
import { configWhatsapp, enviar, ErroWhatsApp, textoDoAviso, whatsappConfigurado, type ConteudoEnvio } from './cliente.ts';

/**
 * Fila de envio do WhatsApp. Quem quer mandar uma mensagem grava na conversa (situação "pendente") e na fila,
 * DENTRO da sua transação; o Worker envia depois do COMMIT. Assim:
 * - nada é enviado se a ação que o originou foi desfeita;
 * - a chave de idempotência impede envio duplicado (inclusive em reprocessamento);
 * - falhas temporárias são tentadas de novo com espera crescente.
 */
export interface Enfileirar {
  candidatoId: string;
  conteudo: ConteudoEnvio;
  autor: { tipo: 'gestora' | 'chatbot' | 'sistema'; usuarioId?: string | null; nome: string };
  /** Texto que fica na conversa (para o código de acesso, sem o código: ele não pode ficar guardado). */
  textoNaConversa?: string;
  chaveIdempotencia: string;
  execucaoId?: string | null;
}

export async function janelaAberta(db: PoolClient, candidatoId: string): Promise<boolean> {
  const r = await db.query<{ aberta: boolean }>(`SELECT COALESCE(janela_whatsapp_ate > now(), false) AS aberta FROM conversas WHERE candidato_id = $1`, [candidatoId]);
  return Boolean(r.rows[0]?.aberta);
}

/** Grava a mensagem e a coloca na fila. Recusa se o WhatsApp não estiver configurado ou se a regra do provedor impedir. */
export async function enfileirar(db: PoolClient, e: Enfileirar): Promise<string | null> {
  if (!(await whatsappConfigurado())) throw badRequest('O WhatsApp ainda não foi configurado (Integração › WhatsApp).', 'whatsapp_nao_configurado');
  const { provedor } = await configWhatsapp();
  // Meta: texto livre só dentro da janela de 24 h aberta pelo candidato. Fora dela, só modelo aprovado.
  if (provedor === 'meta' && e.conteudo.tipo === 'texto' && !(await janelaAberta(db, e.candidatoId))) {
    throw badRequest('Pela regra da Meta, só dá para escrever livremente até 24 h depois da última mensagem do candidato. Use o portal ou um aviso com modelo aprovado.', 'janela_fechada');
  }
  const ja = await db.query('SELECT 1 FROM fila_envio WHERE chave_idempotencia = $1', [e.chaveIdempotencia]);
  if (ja.rowCount) return null; // já enfileirada antes (reprocessamento): não duplica

  const c = await db.query<{ telefone: string; conversa_id: string }>(
    `SELECT c.telefone, cv.id AS conversa_id FROM candidatos c JOIN conversas cv ON cv.candidato_id = c.id WHERE c.id = $1 AND c.excluido_em IS NULL`,
    [e.candidatoId],
  );
  if (!c.rows[0]) throw badRequest('Candidato não encontrado.');
  const texto = e.textoNaConversa ?? (e.conteudo.tipo === 'texto' ? e.conteudo.texto : await textoDoAviso(e.conteudo));
  const m = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_usuario_id, autor_nome, execucao_id, texto, visivel_ao_candidato, situacao_entrega)
     VALUES ($1, 'saida', 'whatsapp', $2, $3, $4, $5, $6, true, 'pendente') RETURNING id, criado_em`,
    [c.rows[0].conversa_id, e.autor.tipo, e.autor.usuarioId ?? null, e.autor.nome, e.execucaoId ?? null, encrypt(texto)],
  );
  await db.query(
    `INSERT INTO fila_envio (mensagem_id, para, conteudo, chave_idempotencia) VALUES ($1, $2, $3, $4)`,
    [m.rows[0].id, c.rows[0].telefone, encrypt(JSON.stringify(e.conteudo)), e.chaveIdempotencia],
  );
  await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE id = $1', [c.rows[0].conversa_id, m.rows[0].id, m.rows[0].criado_em]);
  await db.query('SELECT pg_notify($1, $2)', ['aprovarh_fila_whatsapp', m.rows[0].id]); // acorda o Worker
  return m.rows[0].id;
}

async function situacaoDaMensagem(mensagemId: string, situacao: 'enviada' | 'falhou', wamid?: string) {
  const r = await pool.query<{ candidato_id: string; unidade_id: string }>(
    `UPDATE mensagens m SET situacao_entrega = $2, wamid = COALESCE($3, m.wamid)
       FROM conversas cv JOIN candidatos c ON c.id = cv.candidato_id
      WHERE m.id = $1 AND cv.id = m.conversa_id RETURNING c.id AS candidato_id, c.unidade_id`,
    [mensagemId, situacao, wamid ?? null],
  );
  if (r.rows[0]) await publicar(pool, { tipo: 'mensagem.nova', candidatoId: r.rows[0].candidato_id, unidadeId: r.rows[0].unidade_id });
}

/** Rotina do Worker: envia o que estiver na fila. Cada item é travado (SKIP LOCKED) para não ser enviado duas vezes. */
export async function processarFila(): Promise<number> {
  const max = await cfgNumero('whatsapp.max_tentativas');
  let enviados = 0;
  for (let i = 0; i < 20; i++) {
    const client = await pool.connect();
    let item: { id: string; mensagem_id: string; para: string; conteudo: string; tentativas: number } | undefined;
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT id, mensagem_id, para, conteudo, tentativas FROM fila_envio
          WHERE situacao = 'pendente' AND proxima_tentativa_em <= now() ORDER BY proxima_tentativa_em LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      item = r.rows[0];
      if (item) await client.query(`UPDATE fila_envio SET situacao = 'enviando', tentativas = tentativas + 1 WHERE id = $1`, [item.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    if (!item) break;

    try {
      const wamid = await enviar(decrypt(item.para), JSON.parse(decrypt(item.conteudo)));
      // Depois de enviado, o conteúdo é apagado da fila (o código de acesso não pode ficar guardado).
      await pool.query(`UPDATE fila_envio SET situacao = 'enviada', enviada_em = now(), conteudo = $2, ultimo_erro = NULL WHERE id = $1`, [item.id, encrypt('{}')]);
      await situacaoDaMensagem(item.mensagem_id, 'enviada', wamid);
      enviados++;
    } catch (err) {
      const e = err instanceof ErroWhatsApp ? err : new ErroWhatsApp((err as Error).message, true);
      const tentativas = item.tentativas + 1;
      if (e.temporario && tentativas < max) {
        const esperaMin = Math.min(60, 2 ** tentativas); // 2, 4, 8, 16, 32, 60 min
        await pool.query(`UPDATE fila_envio SET situacao = 'pendente', proxima_tentativa_em = now() + make_interval(mins => $2), ultimo_erro = $3 WHERE id = $1`, [item.id, esperaMin, e.message]);
      } else {
        await pool.query(`UPDATE fila_envio SET situacao = 'falhou', ultimo_erro = $2, conteudo = $3 WHERE id = $1`, [item.id, e.message, encrypt('{}')]);
        await situacaoDaMensagem(item.mensagem_id, 'falhou');
        console.error(`[whatsapp] envio falhou de vez (${tentativas} tentativa(s)): ${e.message}`);
      }
    }
  }
  // Itens presos em "enviando" (Worker caiu no meio) voltam para a fila depois de 10 min.
  await pool.query(`UPDATE fila_envio SET situacao = 'pendente' WHERE situacao = 'enviando' AND proxima_tentativa_em < now() - interval '10 minutes'`);
  return enviados;
}
