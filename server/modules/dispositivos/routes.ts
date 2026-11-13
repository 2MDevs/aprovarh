import { Router } from 'express';
import { z } from 'zod';
import { auditarReq } from '../../core/audit.ts';
import { pool } from '../../db/pool.ts';
import { forbidden, h, notFound, parse } from '../../lib/http.ts';
import { exigirLogin } from '../../middleware/auth.ts';
import { CONFIANCA_DIAS } from '../auth/service.ts';

/**
 * Dispositivos: quem tem `dispositivos.gerenciar` (Desenvolvedor e Diretoria) vê todos;
 * os demais veem só os próprios. Bloquear ou revogar encerra as sessões daquele dispositivo na hora.
 */
export const dispositivosRouter = Router();
dispositivosRouter.use(exigirLogin());

const gerenciaTodos = (req: Express.Request) => req.usuario!.permissoes.has('dispositivos.gerenciar');

dispositivosRouter.get('/', h(async (req, res) => {
  const todos = gerenciaTodos(req);
  const { rows } = await pool.query(
    `SELECT d.id, d.nome, d.sistema, d.navegador, d.tipo, d.ip_primeiro, d.ip_ultimo, d.situacao, d.confiavel_ate,
            d.primeiro_acesso_em, d.ultimo_acesso_em, u.id AS usuario_id, u.nome AS usuario_nome, u.email AS usuario_email
       FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id
      WHERE ($1::boolean OR d.usuario_id = $2) ORDER BY d.ultimo_acesso_em DESC LIMIT 1000`,
    [todos, req.usuario!.id],
  );
  res.json(rows.map((d) => ({
    id: d.id, nome: d.nome, sistema: d.sistema, navegador: d.navegador, tipo: d.tipo, ipPrimeiro: d.ip_primeiro,
    ipUltimo: d.ip_ultimo, situacao: d.situacao === 'confiavel' && d.confiavel_ate && new Date(d.confiavel_ate) < new Date() ? 'expirado' : d.situacao,
    confiavelAte: d.confiavel_ate, primeiroAcessoEm: d.primeiro_acesso_em, ultimoAcessoEm: d.ultimo_acesso_em,
    usuario: { id: d.usuario_id, nome: d.usuario_nome, email: d.usuario_email },
    atual: d.id === req.sessao?.dispositivoId,
  })));
}));

async function alvo(req: Express.Request, id: string) {
  const { rows } = await pool.query('SELECT d.id, d.nome, d.usuario_id, u.nome AS usuario_nome FROM dispositivos d JOIN usuarios u ON u.id = d.usuario_id WHERE d.id = $1', [id]);
  const d = rows[0];
  if (!d) throw notFound('Dispositivo não encontrado.');
  if (d.usuario_id !== req.usuario!.id && !gerenciaTodos(req)) throw forbidden();
  return d;
}

async function encerrarSessoesDoDispositivo(id: string, motivo: string) {
  await pool.query(`UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = $2 WHERE dispositivo_id = $1 AND encerrada_em IS NULL`, [id, motivo]);
}

const acoes = {
  aprovar: { sql: `situacao = 'confiavel', confiavel_ate = now() + make_interval(days => ${CONFIANCA_DIAS})`, encerra: false, gestao: true },
  bloquear: { sql: `situacao = 'bloqueado', confiavel_ate = NULL`, encerra: true, gestao: false },
  revogar: { sql: `situacao = 'revogado', confiavel_ate = NULL`, encerra: true, gestao: false },
} as const;

for (const [acao, cfg] of Object.entries(acoes)) {
  dispositivosRouter.post(`/:id/${acao}`, h(async (req, res) => {
    const id = parse(z.string().uuid(), req.params.id);
    const d = await alvo(req, id);
    // Aprovar a confiança de um dispositivo é decisão de quem gerencia (o próprio usuário confia passando pelo 2FA).
    if (cfg.gestao && !gerenciaTodos(req)) throw forbidden();
    await pool.query(`UPDATE dispositivos SET ${cfg.sql} WHERE id = $1`, [id]);
    if (cfg.encerra) await encerrarSessoesDoDispositivo(id, `dispositivo_${acao}`);
    await auditarReq(req, { acao: `dispositivo.${acao}`, resultado: 'sucesso', item: { tipo: 'dispositivo', id, nome: `${d.nome} (${d.usuario_nome})` } });
    res.json({ ok: true });
  }));
}

dispositivosRouter.delete('/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const d = await alvo(req, id);
  await encerrarSessoesDoDispositivo(id, 'dispositivo_removido');
  await pool.query('DELETE FROM dispositivos WHERE id = $1', [id]);
  await auditarReq(req, { acao: 'dispositivo.removido', resultado: 'sucesso', item: { tipo: 'dispositivo', id, nome: `${d.nome} (${d.usuario_nome})` } });
  res.json({ ok: true });
}));
