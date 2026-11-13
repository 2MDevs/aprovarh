import type { Request, Response } from 'express';
import { env } from '../../config/env.ts';
import { cfgNumero } from '../../core/settings.ts';
import { enviarCodigo2FA, enviarLinkSenha } from '../../core/mailer.ts';
import { pool, type Db } from '../../db/pool.ts';
import { hmac, randomDigits, randomToken } from '../../lib/crypto.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { ipDe } from '../../lib/http.ts';
import { COOKIE_DISPOSITIVO, COOKIE_SESSAO, cookieBase } from '../../middleware/auth.ts';

export const CONFIANCA_DIAS = 30;
export const CODIGO_2FA_MIN = 10;
export const REENVIO_SEG = 60;
export const MAX_TENTATIVAS_2FA = 5;
export const MAX_ERROS_SENHA = 5;
export const BLOQUEIO_SENHA_MIN = 15;
export const LINK_SENHA_MIN = 60;

/** Dispositivo confiável do cookie, se existir e for desta pessoa. */
export async function dispositivoConfiavel(req: Request, usuarioId: string) {
  const token = req.cookies?.[COOKIE_DISPOSITIVO];
  if (!token || typeof token !== 'string') return null;
  const { rows } = await pool.query(
    `SELECT id, situacao, confiavel_ate FROM dispositivos WHERE token_hash = $1 AND usuario_id = $2`,
    [hmac(token), usuarioId],
  );
  const d = rows[0];
  if (!d) return null;
  if (d.situacao === 'bloqueado') return { id: d.id as string, bloqueado: true, confiavel: false };
  const confiavel = d.situacao === 'confiavel' && d.confiavel_ate && new Date(d.confiavel_ate) > new Date();
  return { id: d.id as string, bloqueado: false, confiavel: Boolean(confiavel) };
}

/** Abre a sessão, grava o cookie e registra o login. */
export async function abrirSessao(
  req: Request,
  res: Response,
  u: { id: string; nome: string },
  opcoes: { dispositivoId: string | null; modoConfiguracao: boolean },
  db: Db = pool,
) {
  const ttlHoras = await cfgNumero('seguranca.sessao_horas');
  const token = randomToken();
  const expira = new Date(Date.now() + ttlHoras * 3_600_000);
  await db.query(
    `INSERT INTO sessoes (usuario_id, dispositivo_id, token_hash, expira_em, modo_configuracao, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.id, opcoes.dispositivoId, hmac(token), expira, opcoes.modoConfiguracao, ipDe(req), req.get('user-agent')?.slice(0, 500) ?? null],
  );
  await db.query('UPDATE usuarios SET ultimo_login_em = now(), tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1', [u.id]);
  if (opcoes.dispositivoId) {
    await db.query('UPDATE dispositivos SET ultimo_acesso_em = now(), ip_ultimo = $2 WHERE id = $1', [opcoes.dispositivoId, ipDe(req)]);
  }
  res.cookie(COOKIE_SESSAO, token, cookieBase(ttlHoras * 3_600_000));
}

/** Cria (ou renova) o desafio de 2FA e envia o código por e-mail. Devolve o token do desafio. */
export async function criarDesafio2FA(req: Request, u: { id: string; nome: string; email: string }) {
  // Só um desafio ativo por pessoa.
  await pool.query('UPDATE desafios_2fa SET invalidado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL', [u.id]);
  const token = randomToken();
  const codigo = randomDigits(6);
  await pool.query(
    `INSERT INTO desafios_2fa (usuario_id, token_hash, codigo_hash, expira_em, ip, user_agent)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5, $6)`,
    [u.id, hmac(token), hmac(`2fa:${codigo}`), CODIGO_2FA_MIN, ipDe(req), req.get('user-agent')?.slice(0, 500) ?? null],
  );
  await enviarCodigo2FA(u.email, u.nome, codigo);
  return token;
}

export async function reenviarCodigo(desafioId: string, u: { nome: string; email: string }) {
  const codigo = randomDigits(6);
  await pool.query(
    `UPDATE desafios_2fa SET codigo_hash = $2, tentativas = 0, ultimo_envio_em = now(),
        expira_em = now() + make_interval(mins => $3) WHERE id = $1`,
    [desafioId, hmac(`2fa:${codigo}`), CODIGO_2FA_MIN],
  );
  await enviarCodigo2FA(u.email, u.nome, codigo);
}

/** Depois do 2FA: o dispositivo fica confiável por 30 dias, com token novo no cookie. */
export async function confiarDispositivo(req: Request, res: Response, usuarioId: string, db: Db) {
  const token = randomToken();
  const info = descreverDispositivo(req.get('user-agent'));
  const ate = new Date(Date.now() + CONFIANCA_DIAS * 86_400_000);
  const atual = await dispositivoConfiavel(req, usuarioId);
  let id: string;
  if (atual && !atual.bloqueado) {
    await db.query(
      `UPDATE dispositivos SET token_hash = $2, situacao = 'confiavel', confiavel_ate = $3, ultimo_acesso_em = now(), ip_ultimo = $4 WHERE id = $1`,
      [atual.id, hmac(token), ate, ipDe(req)],
    );
    id = atual.id;
  } else {
    const r = await db.query<{ id: string }>(
      `INSERT INTO dispositivos (usuario_id, token_hash, nome, sistema, navegador, tipo, ip_primeiro, ip_ultimo, situacao, confiavel_ate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, 'confiavel', $8) RETURNING id`,
      [usuarioId, hmac(token), info.nome, info.sistema, info.navegador, info.tipo, ipDe(req), ate],
    );
    id = r.rows[0].id;
  }
  res.cookie(COOKIE_DISPOSITIVO, token, cookieBase(CONFIANCA_DIAS * 86_400_000));
  return id;
}

/** Link de uso único para criar ou redefinir senha. */
export async function enviarLinkDeSenha(u: { id: string; nome: string; email: string }, primeiroAcesso: boolean) {
  await pool.query('UPDATE redefinicoes_senha SET usado_em = now() WHERE usuario_id = $1 AND usado_em IS NULL', [u.id]);
  const token = randomToken();
  await pool.query(
    `INSERT INTO redefinicoes_senha (usuario_id, token_hash, expira_em) VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [u.id, hmac(token), LINK_SENHA_MIN],
  );
  const link = `${env.APP_URL.replace(/\/$/, '')}/definir-senha?token=${encodeURIComponent(token)}`;
  await enviarLinkSenha(u.email, u.nome, link, primeiroAcesso);
}

