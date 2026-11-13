import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ESCOPOS_API, type Permissao } from '../../shared/permissoes.ts';
import { env, isProd } from '../config/env.ts';
import { carregarUsuario } from '../core/access.ts';
import { cfgNumero } from '../core/settings.ts';
import { pool } from '../db/pool.ts';
import { hmac } from '../lib/crypto.ts';
import { forbidden, h, HttpError, ipDe, unauthorized } from '../lib/http.ts';

export const COOKIE_SESSAO = 'arh_sessao';
export const COOKIE_DISPOSITIVO = 'arh_dispositivo';

export function cookieBase(maxAgeMs: number) {
  return { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/', maxAge: maxAgeMs };
}

/** Rotas que NÃO contam como "uso" (não renovam a sessão nem adiam o bloqueio por inatividade). */
const SEM_RENOVACAO = new Set(['/api/auth/sessao', '/api/health', '/api/atualizacao/aviso', '/api/notificacoes/contagem', '/api/eventos']);

/**
 * Lê o cookie de sessão (ou a chave de API) e preenche req.usuario / req.sessao.
 * Não bloqueia nada sozinho: quem exige login é o `exigirLogin`.
 */
export const carregarSessao: RequestHandler = h(async (req, res, next) => {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer aprh_live_')) {
    await carregarChaveApi(req, auth.slice(7));
    return next();
  }

  const token = req.cookies?.[COOKIE_SESSAO];
  if (!token || typeof token !== 'string') return next();

  const { rows } = await pool.query(
    `SELECT s.id, s.usuario_id, s.dispositivo_id, s.expira_em, s.ultimo_uso_em, s.bloqueada_em, s.reautenticada_em,
            s.modo_configuracao, d.situacao AS dispositivo_situacao
       FROM sessoes s LEFT JOIN dispositivos d ON d.id = s.dispositivo_id
      WHERE s.token_hash = $1 AND s.encerrada_em IS NULL`,
    [hmac(token)],
  );
  const s = rows[0];
  if (!s || new Date(s.expira_em) <= new Date() || ['bloqueado', 'revogado'].includes(s.dispositivo_situacao)) {
    if (s) await encerrarSessao(s.id, new Date(s.expira_em) <= new Date() ? 'expirou' : 'dispositivo_bloqueado');
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    return next();
  }

  const usuario = await carregarUsuario(s.usuario_id);
  if (!usuario) {
    await encerrarSessao(s.id, 'usuario_bloqueado');
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    return next();
  }

  const [ttlHoras, bloqueioMin] = await Promise.all([cfgNumero('seguranca.sessao_horas'), cfgNumero('seguranca.bloqueio_minutos')]);
  let bloqueada = Boolean(s.bloqueada_em);
  const ocioso = Date.now() - new Date(s.ultimo_uso_em).getTime() > bloqueioMin * 60_000;

  if (!bloqueada && ocioso) {
    bloqueada = true;
    await pool.query('UPDATE sessoes SET bloqueada_em = now() WHERE id = $1 AND bloqueada_em IS NULL', [s.id]);
  } else if (!bloqueada && !SEM_RENOVACAO.has(req.path) && Date.now() - new Date(s.ultimo_uso_em).getTime() > 30_000) {
    // Renova a validade a cada uso (no máximo uma escrita a cada 30 s).
    const novaValidade = new Date(Date.now() + ttlHoras * 3_600_000);
    await pool.query('UPDATE sessoes SET ultimo_uso_em = now(), expira_em = $2, ip = $3 WHERE id = $1', [s.id, novaValidade, ipDe(req)]);
    res.cookie(COOKIE_SESSAO, token, cookieBase(ttlHoras * 3_600_000));
    s.expira_em = novaValidade;
  }

  req.usuario = usuario;
  req.sessao = {
    id: s.id,
    dispositivoId: s.dispositivo_id,
    bloqueada,
    reautenticadaEm: s.reautenticada_em ? new Date(s.reautenticada_em) : null,
    modoConfiguracao: s.modo_configuracao,
    expiraEm: new Date(s.expira_em),
  };
  next();
});

async function carregarChaveApi(req: Request, chave: string) {
  const { rows } = await pool.query(
    `UPDATE chaves_api SET ultimo_uso_em = now(), ultimo_uso_ip = $2
      WHERE hash = $1 AND revogada_em IS NULL RETURNING id, nome, escopos, criada_por`,
    [hmac(chave), ipDe(req)],
  );
  const k = rows[0];
  if (!k) throw unauthorized('Chave de API inválida ou revogada.', 'chave_invalida');
  const criador = await carregarUsuario(k.criada_por);
  if (!criador) throw unauthorized('A pessoa que criou esta chave não tem mais acesso.', 'chave_invalida');
  // A chave age com as permissões de quem criou, limitadas pelos escopos.
  const liberadas = new Set<Permissao>();
  for (const escopo of k.escopos as (keyof typeof ESCOPOS_API)[]) {
    const exige = ESCOPOS_API[escopo]?.exige;
    if (exige && criador.permissoes.has(exige)) liberadas.add(exige);
  }
  req.usuario = { ...criador, permissoes: liberadas, desenvolvedor: false };
  req.chaveApi = { id: k.id, nome: k.nome, escopos: k.escopos };
}

export async function encerrarSessao(id: string, motivo: string) {
  await pool.query('UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = $2 WHERE id = $1 AND encerrada_em IS NULL', [id, motivo]);
}

export async function encerrarSessoesDoUsuario(usuarioId: string, motivo: string, excetoSessaoId?: string) {
  await pool.query(
    `UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = $2
      WHERE usuario_id = $1 AND encerrada_em IS NULL AND ($3::uuid IS NULL OR id <> $3)`,
    [usuarioId, motivo, excetoSessaoId ?? null],
  );
}

interface OpcoesLogin {
  /** Aceita a sessão bloqueada por inatividade (desbloquear, sair, verificar sessão). */
  permitirBloqueada?: boolean;
  /** Aceita quem ainda precisa trocar a senha (só as rotas de troca de senha e sair). */
  permitirTrocaPendente?: boolean;
  /** Aceita chave de API. Nunca usar em login, sistema, integração ou nas próprias chaves. */
  aceitaChaveApi?: boolean;
}

export function exigirLogin(opcoes: OpcoesLogin = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario) return next(unauthorized());
    if (req.chaveApi && !opcoes.aceitaChaveApi) return next(forbidden('Esta área não aceita chave de API.', 'chave_nao_aceita'));
    if (req.sessao?.bloqueada && !opcoes.permitirBloqueada) {
      return next(new HttpError(423, 'A tela está bloqueada. Desbloqueie com seu PIN ou senha.', 'sessao_bloqueada'));
    }
    if (req.usuario.deveTrocarSenha && !opcoes.permitirTrocaPendente && !req.chaveApi) {
      return next(forbidden('Troque sua senha para continuar.', 'trocar_senha'));
    }
    next();
  };
}

export function exigirPermissao(...permissoes: Permissao[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuario) return next(unauthorized());
    if (!permissoes.every((p) => req.usuario!.permissoes.has(p))) return next(forbidden());
    next();
  };
}

export const exigirDesenvolvedor: RequestHandler = (req, _res, next) => {
  if (!req.usuario?.desenvolvedor || req.chaveApi) return next(forbidden('Somente o Desenvolvedor acessa esta área.', 'somente_desenvolvedor'));
  next();
};

/** Tela Integração: senha reconfirmada nos últimos 10 minutos. */
export const exigirReautenticacao: RequestHandler = (req, _res, next) => {
  const em = req.sessao?.reautenticadaEm;
  if (!em || Date.now() - em.getTime() > 10 * 60_000) {
    return next(new HttpError(403, 'Confirme sua senha para continuar.', 'reautenticar'));
  }
  next();
};

/**
 * Proteção contra CSRF: além do SameSite=Lax, pedidos que alteram dados vindos do navegador
 * precisam ter Origin (ou Referer) igual ao APP_URL.
 */
const ORIGEM = new URL(env.APP_URL).origin;
export const conferirOrigem: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/webhooks/')) return next(); // conferidos por assinatura própria
  let origem = req.get('origin') || null;
  if (!origem && req.get('referer')) {
    try {
      origem = new URL(req.get('referer')!).origin;
    } catch {
      origem = 'invalida';
    }
  }
  if (origem && origem !== ORIGEM) return next(forbidden('Origem da requisição não permitida.', 'origem_invalida'));
  if (!origem && req.cookies?.[COOKIE_SESSAO] && !req.get('authorization')) {
    return next(forbidden('Origem da requisição não informada.', 'origem_invalida'));
  }
  next();
};
