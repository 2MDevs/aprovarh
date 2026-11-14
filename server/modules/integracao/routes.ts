import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.ts';
import { auditarReq } from '../../core/audit.ts';
import { smtpConfigurado, testarSmtp } from '../../core/mailer.ts';
import { cfg, configuracoesDoGrupo, DEFINICOES, ehChaveConfig, gravarConfig, limparCacheConfig } from '../../core/settings.ts';
import { pool, transaction } from '../../db/pool.ts';
import { badRequest, h, HttpError, notFound, parse } from '../../lib/http.ts';
import { exigirDesenvolvedor, exigirLogin, exigirReautenticacao } from '../../middleware/auth.ts';
import { enviarLinkDeSenha } from '../auth/service.ts';
import { whatsappConfigurado } from '../whatsapp/cliente.ts';

/**
 * Tela Integração (somente Desenvolvedor; senha reconfirmada a cada 10 minutos).
 * Os cards da tela vêm daqui: cada um diz se está configurado e quais campos tem.
 */
export const integracaoRouter = Router();
integracaoRouter.use(exigirLogin(), exigirDesenvolvedor, exigirReautenticacao);

/** Lista de cards. Serviços das próximas etapas (WhatsApp, IA) entram aqui quando existirem. */
integracaoRouter.get('/cards', h(async (_req, res) => {
  const smtp = await smtpConfigurado();
  res.json([
    { id: 'atualizacao', aba: 'geral', sigla: 'UP', nome: 'Atualização do sistema', categoria: 'Sistema', descricao: 'Verifica e aplica a versão nova publicada no GitHub.', configurado: true },
    { id: 'seguranca', aba: 'geral', sigla: 'SG', nome: 'Segurança & Sessão', categoria: 'Segurança', descricao: 'Validade da sessão, bloqueio por inatividade e tentativas de PIN.', configurado: true },
    { id: 'admin', aba: 'geral', sigla: 'AD', nome: 'Administrador principal', categoria: 'Acesso', descricao: 'E-mail do administrador e envio de redefinição de senha.', configurado: Boolean(env.ADMIN_EMAIL) },
    { id: 'env', aba: 'geral', sigla: 'ENV', nome: 'Variáveis do .env', categoria: 'Sistema', descricao: 'Mostra quais variáveis estão definidas, sem mostrar valores secretos.', configurado: true },
    { id: 'privacidade', aba: 'geral', sigla: 'LGPD', nome: 'Aviso de privacidade', categoria: 'Cadastro de candidatos', descricao: 'Texto que o candidato aceita antes de enviar a candidatura. Sem ele, o formulário fica fechado.', configurado: Boolean(await cfg('privacidade.aviso')) },
    { id: 'arquivos', aba: 'geral', sigla: 'ARQ', nome: 'Arquivos do candidato', categoria: 'Cadastro de candidatos', descricao: 'Tamanho máximo do currículo (PDF, DOC ou DOCX) e da foto 3x4 (JPG ou PNG).', configurado: true },
    { id: 'whatsapp', aba: 'integracoes', sigla: 'WA', nome: 'WhatsApp', categoria: 'Comunicação', descricao: 'Códigos de acesso, confirmação de entrevistas e conversas com os candidatos. Provedor: Meta (oficial) ou Evolution API.', configurado: await whatsappConfigurado() },
    { id: 'smtp', aba: 'integracoes', sigla: 'SMTP', nome: 'E-mail (SMTP)', categoria: 'Comunicação', descricao: 'Envio dos códigos de acesso (2FA), convites e redefinição de senha.', configurado: smtp },
  ]);
}));

const GRUPOS = ['smtp', 'seguranca', 'arquivos', 'privacidade', 'whatsapp'] as const;

integracaoRouter.get('/config/:grupo', h(async (req, res) => {
  const grupo = parse(z.enum(GRUPOS), req.params.grupo);
  res.json(await configuracoesDoGrupo(grupo));
}));

/**
 * Grava um grupo. Campos de segredo enviados vazios mantêm o valor atual;
 * para apagar um segredo, envie `null` explicitamente.
 */
integracaoRouter.put('/config/:grupo', h(async (req, res) => {
  const grupo = parse(z.enum(GRUPOS), req.params.grupo);
  const body = parse(z.record(z.string(), z.union([z.string().max(20_000), z.null()])), req.body);
  const smtpAntes = await smtpConfigurado();
  const alterados: string[] = [];
  await transaction(async (db) => {
    for (const [chave, valor] of Object.entries(body)) {
      if (!ehChaveConfig(chave) || DEFINICOES[chave].grupo !== grupo) throw badRequest(`Campo desconhecido: ${chave}`);
      if (DEFINICOES[chave].tipo === 'segredo' && valor === '') continue;
      if (chave === 'whatsapp.provedor' && valor && !['meta', 'evolution'].includes(valor)) throw badRequest('Provedor inválido: use "meta" ou "evolution".');
      if (chave === 'whatsapp.evolution_url' && valor && !valor.startsWith('https://')) throw badRequest('O endereço da Evolution API precisa começar com https://.');
      try {
        await gravarConfig(db, chave, valor, req.usuario!.id);
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      alterados.push(chave);
    }
    await auditarReq(req, { acao: 'configuracao.alterada', resultado: 'sucesso', item: { tipo: 'configuracao', nome: grupo }, detalhes: { campos: alterados } }, db);
  });
  limparCacheConfig();
  // Ao configurar o SMTP, o 2FA passa a valer para todos: sessões abertas em modo de configuração são encerradas (menos a atual).
  if (grupo === 'smtp' && !smtpAntes && (await smtpConfigurado())) {
    await pool.query(
      `UPDATE sessoes SET encerrada_em = now(), motivo_encerramento = 'fim_modo_configuracao'
        WHERE modo_configuracao AND encerrada_em IS NULL AND id <> $1`,
      [req.sessao!.id],
    );
  }
  res.json({ ok: true, alterados });
}));

integracaoRouter.post('/smtp/teste', h(async (req, res) => {
  const body = parse(z.object({ para: z.string().trim().email('Informe um e-mail válido.') }), req.body);
  try {
    await testarSmtp(body.para);
  } catch (err) {
    await auditarReq(req, { acao: 'smtp.teste', resultado: 'falha', detalhes: { para: body.para } });
    // Mensagem do servidor de e-mail ajuda a TI a corrigir; não contém segredos.
    throw new HttpError(502, `Não foi possível enviar: ${(err as Error).message.slice(0, 200)}`, 'smtp_falhou');
  }
  await auditarReq(req, { acao: 'smtp.teste', resultado: 'sucesso', detalhes: { para: body.para } });
  res.json({ ok: true });
}));

/** Variáveis do .env em modo leitura: só diz se estão definidas. Nada secreto volta. */
const VARIAVEIS = [
  ['DATABASE_URL', true], ['PORT', false], ['APP_URL', false], ['NODE_ENV', false], ['SETTINGS_ENCRYPTION_KEY', true],
  ['DEVELOPER_EMAILS', false], ['ADMIN_EMAIL', false], ['ADMIN_INITIAL_PASSWORD', true], ['SESSION_TTL_HOURS', false],
  ['LOCK_IDLE_MINUTES', false], ['PIN_MAX_ATTEMPTS', false], ['SMTP_HOST', false], ['SMTP_PORT', false],
  ['SMTP_SECURE', false], ['SMTP_USER', false], ['SMTP_PASS', true], ['SMTP_FROM', false], ['STORAGE_DIR', false], ['CURRICULO_MAX_MB', false], ['FOTO_MAX_MB', false],
  ['TRUST_PROXY', false], ['WHATSAPP_PROVIDER', false], ['WHATSAPP_PHONE_NUMBER_ID', false], ['WHATSAPP_WABA_ID', false], ['WHATSAPP_TOKEN', true], ['WHATSAPP_APP_SECRET', true], ['WHATSAPP_VERIFY_TOKEN', true], ['EVOLUTION_URL', false], ['EVOLUTION_INSTANCE', false], ['EVOLUTION_APIKEY', true], ['EVOLUTION_WEBHOOK_TOKEN', true],
] as const;

integracaoRouter.get('/env', h(async (req, res) => {
  await auditarReq(req, { acao: 'env.visualizado', resultado: 'sucesso' });
  res.json(VARIAVEIS.map(([nome, secreto]) => {
    const v = process.env[nome];
    return { nome, definida: v !== undefined && v !== '', secreta: secreto, valor: secreto || !v ? null : v };
  }));
}));

/** Administrador principal: e-mail (do .env) e envio de link de redefinição. */
integracaoRouter.get('/admin', h(async (_req, res) => {
  if (!env.ADMIN_EMAIL) return res.json({ email: null, existe: false });
  const { rows } = await pool.query('SELECT id, nome, situacao, deve_trocar_senha, ultimo_login_em FROM usuarios WHERE lower(email) = lower($1) AND excluido_em IS NULL', [env.ADMIN_EMAIL]);
  res.json({ email: env.ADMIN_EMAIL, existe: Boolean(rows[0]), ...(rows[0] && { situacao: rows[0].situacao, deveTrocarSenha: rows[0].deve_trocar_senha, ultimoLoginEm: rows[0].ultimo_login_em }) });
}));

integracaoRouter.post('/admin/enviar-redefinicao', h(async (req, res) => {
  if (!env.ADMIN_EMAIL) throw badRequest('ADMIN_EMAIL não está definido no .env.');
  if (!(await smtpConfigurado())) throw badRequest('Configure o e-mail (SMTP) antes.');
  const { rows } = await pool.query('SELECT id, nome, email FROM usuarios WHERE lower(email) = lower($1) AND excluido_em IS NULL', [env.ADMIN_EMAIL]);
  if (!rows[0]) throw notFound('O administrador principal ainda não existe.');
  await enviarLinkDeSenha(rows[0], false);
  await auditarReq(req, { acao: 'senha.link_enviado', resultado: 'sucesso', item: { tipo: 'usuario', id: rows[0].id, nome: rows[0].email }, detalhes: { pedidoPor: 'integração' } });
  res.json({ ok: true });
}));
