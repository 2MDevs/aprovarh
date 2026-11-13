import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.ts';
import { h, parse } from '../../lib/http.ts';
import { exigirLogin } from '../../middleware/auth.ts';

/** Sino de notificações: cada pessoa vê só as suas. */
export const notificacoesRouter = Router();
notificacoesRouter.use(exigirLogin({ permitirBloqueada: true }));

notificacoesRouter.get('/contagem', h(async (req, res) => {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notificacoes WHERE usuario_id = $1 AND lida_em IS NULL', [req.usuario!.id]);
  res.json({ naoLidas: rows[0].n });
}));

notificacoesRouter.get('/', exigirLogin(), h(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, tipo, titulo, texto, link, lida_em, criada_em FROM notificacoes WHERE usuario_id = $1 ORDER BY criada_em DESC LIMIT 100',
    [req.usuario!.id],
  );
  res.json(rows.map((n) => ({ id: n.id, tipo: n.tipo, titulo: n.titulo, texto: n.texto, link: n.link, lida: Boolean(n.lida_em), criadaEm: n.criada_em })));
}));

notificacoesRouter.post('/lidas', exigirLogin(), h(async (req, res) => {
  const body = parse(z.object({ ids: z.array(z.string().uuid()).max(200).optional() }), req.body);
  await pool.query(
    'UPDATE notificacoes SET lida_em = now() WHERE usuario_id = $1 AND lida_em IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))',
    [req.usuario!.id, body.ids ?? null],
  );
  res.json({ ok: true });
}));
