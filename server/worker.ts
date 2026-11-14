import { migrate } from './db/migrate.ts';
import { pool, transaction } from './db/pool.ts';
import { expirarLiberacoes } from './modules/portal/servico.ts';
import { processarFila } from './modules/whatsapp/envio.ts';
import { processarEntradas } from './modules/whatsapp/entrada.ts';

/**
 * Worker: rotinas em segundo plano, em processo separado da API.
 * Nesta etapa: limpeza de sessões, desafios de 2FA e links de senha vencidos.
 * Nas próximas etapas: fila do WhatsApp, expiração diária do portal (00:00 Brasília), lixeira e o motor de automações.
 * Cada rotina usa uma trava (advisory lock) para nunca rodar duas vezes ao mesmo tempo.
 */
interface Rotina {
  nome: string;
  intervaloMs: number;
  trava: number;
  executar: () => Promise<string | void>;
}

const rotinas: Rotina[] = [
  {
    // Mensagens recebidas pelo WhatsApp (guardadas pelo webhook) e respostas automáticas da entrevista.
    nome: 'whatsapp-entrada',
    intervaloMs: 3_000,
    trava: 7240103,
    executar: async () => {
      const n = await processarEntradas();
      if (n) return `${n} evento(s) do WhatsApp processado(s)`;
    },
  },
  {
    // Fila de envio do WhatsApp (com novas tentativas).
    nome: 'whatsapp-envio',
    intervaloMs: 3_000,
    trava: 7240104,
    executar: async () => {
      const n = await processarFila();
      if (n) return `${n} mensagem(ns) enviada(s) pelo WhatsApp`;
    },
  },
  {
    // O acesso já é barrado em toda requisição às 23:59:59; aqui as liberações viram "expirada",
    // as sessões são encerradas e o evento "Acesso expirado" é gerado para as automações.
    nome: 'expiracao-do-portal',
    intervaloMs: 60_000,
    trava: 7240102,
    executar: async () => {
      const n = await transaction((db) => expirarLiberacoes(db));
      if (n) return `${n} acesso(s) ao portal expirado(s)`;
    },
  },
  {
    nome: 'limpeza-de-acesso',
    intervaloMs: 15 * 60_000,
    trava: 7240101,
    executar: async () => {
      const s = await pool.query(`UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = 'expirou' WHERE encerrada_em IS NULL AND expira_em <= now()`);
      // Histórico de sessões, desafios e links fica 90 dias (auditoria guarda o resto para sempre).
      const d = await pool.query(`DELETE FROM desafios_2fa WHERE criado_em < now() - interval '90 days'`);
      const r = await pool.query(`DELETE FROM redefinicoes_senha WHERE criado_em < now() - interval '90 days'`);
      const v = await pool.query(`DELETE FROM sessoes WHERE encerrada_em < now() - interval '90 days'`);
      return `${s.rowCount} sessões expiradas; removidos ${d.rowCount} desafios, ${r.rowCount} links e ${v.rowCount} sessões antigas`;
    },
  },
];

async function rodar(r: Rotina) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [r.trava]);
    if (!rows[0].ok) return;
    try {
      const resumo = await r.executar();
      if (resumo) console.log(`[worker] ${r.nome}: ${resumo}`);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [r.trava]);
    }
  } catch (err) {
    console.error(`[worker] ${r.nome} falhou`, err);
  } finally {
    client.release();
  }
}

async function iniciar() {
  await migrate();
  console.log('[worker] iniciado');
  for (const r of rotinas) {
    void rodar(r);
    setInterval(() => void rodar(r), r.intervaloMs);
  }
}

process.on('SIGTERM', () => pool.end().finally(() => process.exit(0)));
iniciar().catch((err) => {
  console.error('[worker] não foi possível iniciar:', err);
  process.exit(1);
});
