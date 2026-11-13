import { Router } from 'express';
import { z } from 'zod';
import { isDeveloperEmail } from '../../config/env.ts';
import { auditarReq } from '../../core/audit.ts';
import { smtpConfigurado } from '../../core/mailer.ts';
import { cfgNumero } from '../../core/settings.ts';
import { pool, transaction } from '../../db/pool.ts';
import { hmac, safeEqual } from '../../lib/crypto.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { badRequest, forbidden, h, HttpError, parse, tooMany, unauthorized } from '../../lib/http.ts';
import { conferirSenha, hashSenha, validarPin, validarSenha } from '../../lib/password.ts';
import { COOKIE_SESSAO, encerrarSessao, encerrarSessoesDoUsuario, exigirLogin } from '../../middleware/auth.ts';
import { limiteAutenticacao } from '../../middleware/limits.ts';
import {
  abrirSessao, BLOQUEIO_SENHA_MIN, confiarDispositivo, criarDesafio2FA, dispositivoConfiavel, enviarLinkDeSenha,
  MAX_ERROS_SENHA, MAX_TENTATIVAS_2FA, reenviarCodigo, REENVIO_SEG,
} from './service.ts';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254);
const MSG_LOGIN_INVALIDO = 'E-mail ou senha incorretos.';

// ── Login (etapa 1: senha) ─────────────────────────────────────────────────
authRouter.post('/login', limiteAutenticacao, h(async (req, res) => {
  const body = parse(z.object({ email, senha: z.string().min(1, 'Informe a senha.').max(128) }), req.body);
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.senha_hash, u.situacao, u.bloqueado_ate, u.tentativas_falhas, u.admin_inicial,
            u.setor, p.chave AS perfil_chave, p.nome AS perfil_nome
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id
      WHERE lower(u.email) = $1 AND u.excluido_em IS NULL`,
    [body.email],
  );
  const u = rows[0];
  const ator = u ? { usuarioId: u.id, usuarioNome: u.nome, perfil: u.perfil_nome, setor: u.setor } : { usuarioNome: body.email };

  if (u?.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
    await auditarReq(req, { acao: 'login', resultado: 'bloqueado', ator, detalhes: { motivo: 'muitas senhas erradas' } });
    throw new HttpError(423, `Conta bloqueada por ${BLOQUEIO_SENHA_MIN} minutos depois de várias senhas erradas.`, 'conta_bloqueada');
  }

  const senhaOk = await conferirSenha(body.senha, u?.senha_hash ?? null);
  if (!u || !senhaOk) {
    if (u) {
      const tentativas = u.tentativas_falhas + 1;
      const bloquear = tentativas >= MAX_ERROS_SENHA;
      await pool.query(
        `UPDATE usuarios SET tentativas_falhas = $2, bloqueado_ate = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE bloqueado_ate END WHERE id = $1`,
        [u.id, bloquear ? 0 : tentativas, bloquear, BLOQUEIO_SENHA_MIN],
      );
      await auditarReq(req, { acao: 'login', resultado: bloquear ? 'bloqueado' : 'falha', ator, detalhes: { motivo: 'senha incorreta', tentativas } });
    } else {
      await auditarReq(req, { acao: 'login', resultado: 'falha', ator, detalhes: { motivo: 'e-mail não cadastrado' } });
    }
    throw unauthorized(MSG_LOGIN_INVALIDO, 'login_invalido');
  }

  if (u.situacao !== 'ativo') {
    await auditarReq(req, { acao: 'login', resultado: 'negado', ator, detalhes: { motivo: 'usuário bloqueado' } });
    throw forbidden('Seu acesso está bloqueado. Fale com o administrador.', 'usuario_bloqueado');
  }

  const dispositivo = await dispositivoConfiavel(req, u.id);
  if (dispositivo?.bloqueado) {
    await auditarReq(req, { acao: 'login', resultado: 'negado', ator, detalhes: { motivo: 'dispositivo bloqueado' } });
    throw forbidden('Este dispositivo foi bloqueado. Fale com o administrador.', 'dispositivo_bloqueado');
  }

  // Dispositivo já confiável: entra direto.
  if (dispositivo?.confiavel) {
    await transaction(async (db) => {
      await abrirSessao(req, res, u, { dispositivoId: dispositivo.id, modoConfiguracao: false }, db);
      await auditarReq(req, { acao: 'login', resultado: 'sucesso', ator, detalhes: { dispositivo: 'confiável' } }, db);
    });
    return res.json({ etapa: 'ok' });
  }

  // Modo de configuração inicial: sem SMTP não há como enviar o código.
  if (!(await smtpConfigurado())) {
    const podeEntrar = u.admin_inicial || (u.perfil_chave === 'desenvolvedor' && isDeveloperEmail(u.email));
    if (!podeEntrar) {
      await auditarReq(req, { acao: 'login', resultado: 'negado', ator, detalhes: { motivo: 'SMTP não configurado' } });
      throw forbidden('O e-mail do sistema ainda não foi configurado. Fale com a TI.', 'smtp_nao_configurado');
    }
    await transaction(async (db) => {
      await abrirSessao(req, res, u, { dispositivoId: null, modoConfiguracao: true }, db);
      await auditarReq(req, { acao: 'login', resultado: 'sucesso', ator, detalhes: { modo: 'configuração inicial (sem 2FA)' } }, db);
    });
    return res.json({ etapa: 'ok', modoConfiguracao: true });
  }

  try {
    const desafio = await criarDesafio2FA(req, u);
    await auditarReq(req, { acao: '2fa.codigo_enviado', resultado: 'sucesso', ator });
    return res.json({ etapa: '2fa', desafio, emailMascarado: mascararEmail(u.email), reenvioEmSegundos: REENVIO_SEG });
  } catch (err) {
    console.error('[2fa] falha ao enviar o código', err);
    await auditarReq(req, { acao: '2fa.codigo_enviado', resultado: 'falha', ator, detalhes: { motivo: 'falha no envio do e-mail' } });
    throw new HttpError(502, 'Não foi possível enviar o código por e-mail. Tente de novo em instantes.', 'email_falhou');
  }
}));

// ── Login (etapa 2: código do e-mail) ──────────────────────────────────────
const desafioSchema = z.object({ desafio: z.string().min(20).max(200) });

async function buscarDesafio(token: string) {
  const { rows } = await pool.query(
    `SELECT d.id, d.usuario_id, d.codigo_hash, d.expira_em, d.tentativas, d.ultimo_envio_em,
            u.nome, u.email, u.setor, u.situacao, p.nome AS perfil_nome
       FROM desafios_2fa d JOIN usuarios u ON u.id = d.usuario_id JOIN perfis p ON p.id = u.perfil_id
      WHERE d.token_hash = $1 AND d.usado_em IS NULL AND d.invalidado_em IS NULL`,
    [hmac(token)],
  );
  return rows[0];
}

authRouter.post('/2fa/verificar', limiteAutenticacao, h(async (req, res) => {
  const body = parse(desafioSchema.extend({ codigo: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 números.') }), req.body);
  const d = await buscarDesafio(body.desafio);
  if (!d || d.situacao !== 'ativo') throw badRequest('Este código não vale mais. Entre de novo.', 'desafio_invalido');
  const ator = { usuarioId: d.usuario_id, usuarioNome: d.nome, perfil: d.perfil_nome, setor: d.setor };

  if (new Date(d.expira_em) <= new Date()) {
    await auditarReq(req, { acao: '2fa.verificar', resultado: 'falha', ator, detalhes: { motivo: 'código expirado' } });
    throw badRequest('O código expirou. Peça um novo.', 'codigo_expirado');
  }
  if (!safeEqual(hmac(`2fa:${body.codigo}`), d.codigo_hash)) {
    const tentativas = d.tentativas + 1;
    const esgotou = tentativas >= MAX_TENTATIVAS_2FA;
    await pool.query(`UPDATE desafios_2fa SET tentativas = $2, invalidado_em = CASE WHEN $3 THEN now() END WHERE id = $1`, [d.id, tentativas, esgotou]);
    await auditarReq(req, { acao: '2fa.verificar', resultado: esgotou ? 'bloqueado' : 'falha', ator, detalhes: { tentativas } });
    if (esgotou) throw badRequest('Código errado muitas vezes. Entre de novo para receber outro.', 'desafio_invalido');
    throw badRequest(`Código incorreto. Restam ${MAX_TENTATIVAS_2FA - tentativas} tentativa(s).`, 'codigo_incorreto');
  }

  await transaction(async (db) => {
    await db.query('UPDATE desafios_2fa SET usado_em = now() WHERE id = $1', [d.id]);
    const dispositivoId = await confiarDispositivo(req, res, d.usuario_id, db);
    await abrirSessao(req, res, { id: d.usuario_id, nome: d.nome }, { dispositivoId, modoConfiguracao: false }, db);
    await auditarReq(req, { acao: 'login', resultado: 'sucesso', ator, detalhes: { segundoFator: 'e-mail', dispositivo: 'confiável por 30 dias' } }, db);
  });
  res.json({ etapa: 'ok' });
}));

authRouter.post('/2fa/reenviar', limiteAutenticacao, h(async (req, res) => {
  const body = parse(desafioSchema, req.body);
  const d = await buscarDesafio(body.desafio);
  if (!d || d.situacao !== 'ativo') throw badRequest('Este código não vale mais. Entre de novo.', 'desafio_invalido');
  const espera = REENVIO_SEG - Math.floor((Date.now() - new Date(d.ultimo_envio_em).getTime()) / 1000);
  if (espera > 0) throw tooMany(`Aguarde ${espera} segundos para pedir outro código.`);
  await reenviarCodigo(d.id, d);
  await auditarReq(req, { acao: '2fa.codigo_reenviado', resultado: 'sucesso', ator: { usuarioId: d.usuario_id, usuarioNome: d.nome, perfil: d.perfil_nome, setor: d.setor } });
  res.json({ ok: true, reenvioEmSegundos: REENVIO_SEG });
}));

// ── Sessão atual ───────────────────────────────────────────────────────────
authRouter.get('/sessao', h(async (req, res) => {
  if (!req.usuario || req.chaveApi) return res.json({ logado: false, smtpConfigurado: await smtpConfigurado() });
  const u = req.usuario;
  res.json({
    logado: true,
    bloqueada: req.sessao?.bloqueada ?? false,
    deveTrocarSenha: u.deveTrocarSenha,
    modoConfiguracao: req.sessao?.modoConfiguracao ?? false,
    smtpConfigurado: await smtpConfigurado(),
    bloqueioMinutos: await cfgNumero('seguranca.bloqueio_minutos'),
    expiraEm: req.sessao?.expiraEm,
    usuario: {
      id: u.id, nome: u.nome, email: u.email, setor: u.setor, perfil: u.perfilNome, perfilChave: u.perfilChave,
      desenvolvedor: u.desenvolvedor, todasUnidades: u.todasUnidades, unidades: u.unidades, temPin: u.temPin,
      permissoes: [...u.permissoes],
    },
  });
}));

authRouter.post('/sair', exigirLogin({ permitirBloqueada: true, permitirTrocaPendente: true }), h(async (req, res) => {
  if (req.sessao) await encerrarSessao(req.sessao.id, 'saiu');
  await auditarReq(req, { acao: 'logout', resultado: 'sucesso' });
  res.clearCookie(COOKIE_SESSAO, { path: '/' });
  res.json({ ok: true });
}));

// ── Bloqueio por inatividade ───────────────────────────────────────────────
authRouter.post('/bloquear', exigirLogin({ permitirBloqueada: true }), h(async (req, res) => {
  await pool.query('UPDATE sessoes SET bloqueada_em = COALESCE(bloqueada_em, now()) WHERE id = $1', [req.sessao!.id]);
  await auditarReq(req, { acao: 'sessao.bloqueada', resultado: 'sucesso' });
  res.json({ ok: true });
}));

authRouter.post('/desbloquear', limiteAutenticacao, exigirLogin({ permitirBloqueada: true }), h(async (req, res) => {
  const body = parse(z.object({ pin: z.string().max(8).optional(), senha: z.string().max(128).optional() }).refine((b) => b.pin || b.senha, 'Informe o PIN ou a senha.'), req.body);
  const { rows } = await pool.query('SELECT pin_hash, senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  const ok = body.pin ? await conferirSenha(body.pin, rows[0]?.pin_hash ?? null) : await conferirSenha(body.senha!, rows[0]?.senha_hash ?? null);
  if (!ok) {
    const max = await cfgNumero('seguranca.pin_tentativas');
    const r = await pool.query<{ pin_tentativas: number }>('UPDATE sessoes SET pin_tentativas = pin_tentativas + 1 WHERE id = $1 RETURNING pin_tentativas', [req.sessao!.id]);
    const tentativas = r.rows[0].pin_tentativas;
    if (tentativas >= max) {
      await encerrarSessao(req.sessao!.id, 'pin_errado');
      await auditarReq(req, { acao: 'sessao.desbloquear', resultado: 'bloqueado', detalhes: { tentativas, motivo: 'tentativas esgotadas, sessão encerrada' } });
      res.clearCookie(COOKIE_SESSAO, { path: '/' });
      throw unauthorized('Tentativas esgotadas. Entre novamente.', 'sem_sessao');
    }
    await auditarReq(req, { acao: 'sessao.desbloquear', resultado: 'falha', detalhes: { tentativas } });
    throw badRequest(`${body.pin ? 'PIN' : 'Senha'} incorreto(a). Restam ${max - tentativas} tentativa(s).`, 'desbloqueio_incorreto');
  }
  await pool.query('UPDATE sessoes SET bloqueada_em = NULL, pin_tentativas = 0, ultimo_uso_em = now() WHERE id = $1', [req.sessao!.id]);
  await auditarReq(req, { acao: 'sessao.desbloquear', resultado: 'sucesso' });
  res.json({ ok: true });
}));

// ── Reautenticação (tela Integração, vale 10 minutos) ──────────────────────
authRouter.post('/reautenticar', limiteAutenticacao, exigirLogin(), h(async (req, res) => {
  const body = parse(z.object({ senha: z.string().min(1).max(128) }), req.body);
  const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  if (!(await conferirSenha(body.senha, rows[0]?.senha_hash ?? null))) {
    await auditarReq(req, { acao: 'reautenticar', resultado: 'falha' });
    throw badRequest('Senha incorreta.', 'senha_incorreta');
  }
  await pool.query('UPDATE sessoes SET reautenticada_em = now() WHERE id = $1', [req.sessao!.id]);
  await auditarReq(req, { acao: 'reautenticar', resultado: 'sucesso' });
  res.json({ ok: true, validoPorMinutos: 10 });
}));

// ── Senha ──────────────────────────────────────────────────────────────────
authRouter.post('/trocar-senha', limiteAutenticacao, exigirLogin({ permitirTrocaPendente: true }), h(async (req, res) => {
  const body = parse(z.object({ atual: z.string().min(1).max(128), nova: z.string().max(128) }), req.body);
  const erro = validarSenha(body.nova);
  if (erro) throw badRequest(erro, 'senha_fraca');
  if (body.atual === body.nova) throw badRequest('A nova senha precisa ser diferente da atual.', 'senha_repetida');
  const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  if (!(await conferirSenha(body.atual, rows[0]?.senha_hash ?? null))) {
    await auditarReq(req, { acao: 'senha.trocar', resultado: 'falha', detalhes: { motivo: 'senha atual incorreta' } });
    throw badRequest('A senha atual está incorreta.', 'senha_incorreta');
  }
  await transaction(async (db) => {
    await db.query('UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = false, atualizado_em = now() WHERE id = $1', [req.usuario!.id, await hashSenha(body.nova)]);
    await auditarReq(req, { acao: 'senha.trocar', resultado: 'sucesso' }, db);
  });
  // As outras sessões da pessoa são encerradas; a atual continua.
  await encerrarSessoesDoUsuario(req.usuario!.id, 'senha_trocada', req.sessao?.id);
  res.json({ ok: true });
}));

authRouter.post('/esqueci-senha', limiteAutenticacao, h(async (req, res) => {
  const body = parse(z.object({ email }), req.body);
  const resposta = { ok: true, mensagem: 'Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha.' };
  if (!(await smtpConfigurado())) throw new HttpError(503, 'O envio de e-mails ainda não foi configurado. Fale com a TI.', 'smtp_nao_configurado');
  const { rows } = await pool.query(`SELECT id, nome, email, situacao FROM usuarios WHERE lower(email) = $1 AND excluido_em IS NULL`, [body.email]);
  const u = rows[0];
  if (u && u.situacao === 'ativo') {
    try {
      await enviarLinkDeSenha(u, false);
      await auditarReq(req, { acao: 'senha.link_enviado', resultado: 'sucesso', ator: { usuarioId: u.id, usuarioNome: u.nome } });
    } catch (err) {
      console.error('[senha] falha ao enviar link', err);
      await auditarReq(req, { acao: 'senha.link_enviado', resultado: 'falha', ator: { usuarioId: u.id, usuarioNome: u.nome } });
    }
  } else {
    await auditarReq(req, { acao: 'senha.link_enviado', resultado: 'negado', ator: { usuarioNome: body.email }, detalhes: { motivo: u ? 'usuário bloqueado' : 'e-mail não cadastrado' } });
  }
  res.json(resposta); // mesma resposta sempre: não revela quem tem conta
}));

authRouter.post('/redefinir-senha', limiteAutenticacao, h(async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20).max(200), senha: z.string().max(128) }), req.body);
  const erro = validarSenha(body.senha);
  if (erro) throw badRequest(erro, 'senha_fraca');
  const { rows } = await pool.query(
    `SELECT r.id, r.usuario_id, u.nome FROM redefinicoes_senha r JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.token_hash = $1 AND r.usado_em IS NULL AND r.expira_em > now() AND u.excluido_em IS NULL AND u.situacao = 'ativo'`,
    [hmac(body.token)],
  );
  const r = rows[0];
  if (!r) throw badRequest('Este link não vale mais. Peça um novo.', 'link_invalido');
  await transaction(async (db) => {
    await db.query('UPDATE redefinicoes_senha SET usado_em = now() WHERE id = $1', [r.id]);
    await db.query('UPDATE usuarios SET senha_hash = $2, deve_trocar_senha = false, tentativas_falhas = 0, bloqueado_ate = NULL, atualizado_em = now() WHERE id = $1', [r.usuario_id, await hashSenha(body.senha)]);
    await auditarReq(req, { acao: 'senha.redefinida', resultado: 'sucesso', ator: { usuarioId: r.usuario_id, usuarioNome: r.nome } }, db);
  });
  await encerrarSessoesDoUsuario(r.usuario_id, 'senha_redefinida');
  res.json({ ok: true });
}));

// ── Minha conta: PIN, sessões e dispositivos próprios ──────────────────────
export const contaRouter = Router();
contaRouter.use(exigirLogin());

contaRouter.put('/pin', limiteAutenticacao, h(async (req, res) => {
  const body = parse(z.object({ senha: z.string().min(1).max(128), pin: z.string() }), req.body);
  const erro = validarPin(body.pin);
  if (erro) throw badRequest(erro, 'pin_invalido');
  const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  if (!(await conferirSenha(body.senha, rows[0]?.senha_hash ?? null))) throw badRequest('Senha incorreta.', 'senha_incorreta');
  await pool.query('UPDATE usuarios SET pin_hash = $2, atualizado_em = now() WHERE id = $1', [req.usuario!.id, await hashSenha(body.pin)]);
  await auditarReq(req, { acao: req.usuario!.temPin ? 'pin.alterado' : 'pin.criado', resultado: 'sucesso' });
  res.json({ ok: true });
}));

contaRouter.delete('/pin', h(async (req, res) => {
  await pool.query('UPDATE usuarios SET pin_hash = NULL, atualizado_em = now() WHERE id = $1', [req.usuario!.id]);
  await auditarReq(req, { acao: 'pin.removido', resultado: 'sucesso' });
  res.json({ ok: true });
}));

contaRouter.get('/sessoes', h(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.criada_em, s.ultimo_uso_em, s.expira_em, s.ip, s.user_agent, d.nome AS dispositivo
       FROM sessoes s LEFT JOIN dispositivos d ON d.id = s.dispositivo_id
      WHERE s.usuario_id = $1 AND s.encerrada_em IS NULL AND s.expira_em > now() ORDER BY s.ultimo_uso_em DESC`,
    [req.usuario!.id],
  );
  res.json(rows.map((s) => ({
    id: s.id, criadaEm: s.criada_em, ultimoUsoEm: s.ultimo_uso_em, expiraEm: s.expira_em, ip: s.ip,
    dispositivo: s.dispositivo ?? descreverDispositivo(s.user_agent).nome, atual: s.id === req.sessao?.id,
  })));
}));

contaRouter.delete('/sessoes/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  const r = await pool.query(
    `UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = 'encerrada_pelo_usuario'
      WHERE id = $1 AND usuario_id = $2 AND encerrada_em IS NULL`,
    [id, req.usuario!.id],
  );
  await auditarReq(req, { acao: 'sessao.encerrada', resultado: r.rowCount ? 'sucesso' : 'falha', item: { tipo: 'sessao', id } });
  res.json({ ok: Boolean(r.rowCount) });
}));

contaRouter.post('/sessoes/encerrar-outras', h(async (req, res) => {
  await encerrarSessoesDoUsuario(req.usuario!.id, 'encerrada_pelo_usuario', req.sessao?.id);
  await auditarReq(req, { acao: 'sessao.encerrar_outras', resultado: 'sucesso' });
  res.json({ ok: true });
}));

function mascararEmail(e: string): string {
  const [nome, dominio] = e.split('@');
  return `${nome.slice(0, 2)}${'•'.repeat(Math.max(1, nome.length - 2))}@${dominio}`;
}
