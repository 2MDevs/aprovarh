import type { Request, Response } from 'express';
import pg from 'pg';
import { env } from '../config/env.ts';
import type { Db } from '../db/pool.ts';
import type { UsuarioContexto } from '../types.d.ts';

/**
 * Tempo real por Server-Sent Events.
 * - Quem publica chama `publicar(db, evento)` DENTRO da transação: o PostgreSQL só entrega o NOTIFY
 *   depois do COMMIT, então ninguém é avisado de algo que foi desfeito.
 * - A API escuta o canal com uma conexão própria (LISTEN) e repassa para os navegadores abertos.
 *   Assim, eventos do Worker (WhatsApp, automações) chegam do mesmo jeito.
 * - Cada pessoa só recebe eventos das unidades que enxerga. O evento leva só ids; os dados
 *   são buscados pela tela nas rotas normais, que conferem a permissão.
 */
const CANAL = 'aprovarh_eventos';

export type TipoEvento = 'mensagem.nova' | 'candidato.atualizado' | 'candidatura.nova' | 'conversa.lida' | 'notificacao.nova';

export interface EventoTempoReal {
  tipo: TipoEvento;
  candidatoId?: string;
  unidadeId?: string;
  usuarioId?: string; // só para esta pessoa (ex.: notificação, leitura)
}

export async function publicar(db: Db, evento: EventoTempoReal) {
  await db.query('SELECT pg_notify($1, $2)', [CANAL, JSON.stringify(evento)]);
}

interface Cliente { res: Response; usuario: UsuarioContexto }
const clientes = new Set<Cliente>();

function podeReceber(c: Cliente, e: EventoTempoReal): boolean {
  if (e.usuarioId) return e.usuarioId === c.usuario.id;
  if (!c.usuario.permissoes.has('candidatos.ver')) return false;
  if (!e.unidadeId) return true;
  return c.usuario.todasUnidades || c.usuario.unidades.includes(e.unidadeId);
}

function entregar(e: EventoTempoReal) {
  const linha = `event: ${e.tipo}\ndata: ${JSON.stringify({ candidatoId: e.candidatoId, unidadeId: e.unidadeId })}\n\n`;
  for (const c of clientes) if (podeReceber(c, e)) c.res.write(linha);
}

let ouvinte: pg.Client | null = null;

/** Conexão LISTEN com reconexão automática. Chamada uma vez ao iniciar a API. */
export async function iniciarTempoReal() {
  const conectar = async () => {
    const c = new pg.Client({ connectionString: env.DATABASE_URL });
    c.on('notification', (msg) => {
      try {
        entregar(JSON.parse(msg.payload || '{}'));
      } catch {
        /* payload inválido: ignora */
      }
    });
    c.on('error', (err) => {
      console.error('[tempo-real] conexão LISTEN caiu, reconectando', err.message);
      ouvinte = null;
      setTimeout(() => void conectar().catch(() => {}), 5000);
    });
    await c.connect();
    await c.query(`LISTEN ${CANAL}`);
    ouvinte = c;
  };
  await conectar();
}

/** GET /api/eventos — o navegador fica conectado e recebe os avisos. */
export function rotaEventos(req: Request, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx: não segurar o fluxo
  });
  res.write(`retry: 5000\nevent: conectado\ndata: {"ok":${ouvinte ? 'true' : 'false'}}\n\n`);
  const cliente: Cliente = { res, usuario: req.usuario! };
  clientes.add(cliente);
  // Mantém a conexão viva e encerra se a sessão acabar (o navegador reconecta e a sessão é conferida de novo).
  const pulso = setInterval(() => res.write(': pulso\n\n'), 25_000);
  const limite = setTimeout(() => res.end(), 10 * 60_000);
  req.on('close', () => {
    clearInterval(pulso);
    clearTimeout(limite);
    clientes.delete(cliente);
  });
}
