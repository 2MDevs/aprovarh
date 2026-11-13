import type { PoolClient } from 'pg';
import { Router } from 'express';
import { z } from 'zod';
import { TODAS_PERMISSOES, type Permissao } from '../../../shared/permissoes.ts';
import { isDeveloperEmail } from '../../config/env.ts';
import { auditarReq } from '../../core/audit.ts';
import { smtpConfigurado } from '../../core/mailer.ts';
import { pool, transaction } from '../../db/pool.ts';
import { badRequest, conflict, forbidden, h, notFound, parse } from '../../lib/http.ts';
import { hashSenha, validarSenha } from '../../lib/password.ts';
import { encerrarSessoesDoUsuario, exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { enviarLinkDeSenha } from '../auth/service.ts';

// ═══════════════════════ Usuários internos ═══════════════════════
export const usuariosRouter = Router();
usuariosRouter.use(exigirLogin(), exigirPermissao('usuarios.gerenciar'));

const uuid = z.string().uuid();
const dadosUsuario = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(160),
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.').max(254),
  perfilId: uuid,
  setor: z.string().trim().max(80).nullable().optional(),
  todasUnidades: z.boolean().default(false),
  unidades: z.array(uuid).max(500).default([]),
});

/**
 * Decide o perfil a gravar. E-mail em DEVELOPER_EMAILS recebe sempre o perfil Desenvolvedor;
 * ninguém escolhe esse perfil pela tela, e ninguém concede permissões que não tem.
 */
async function perfilFinal(perfilId: string, email: string, quemPede: Express.Request['usuario']): Promise<string> {
  if (isDeveloperEmail(email)) {
    const dev = await pool.query<{ id: string }>(`SELECT id FROM perfis WHERE chave = 'desenvolvedor'`);
    return dev.rows[0].id;
  }
  const { rows } = await pool.query<{ chave: string; permissoes: string[] }>('SELECT chave, permissoes FROM perfis WHERE id = $1', [perfilId]);
  const p = rows[0];
  if (!p) throw badRequest('Perfil não encontrado.');
  if (p.chave === 'desenvolvedor') throw badRequest('O perfil Desenvolvedor é definido pela TI (DEVELOPER_EMAILS).');
  const faltando = p.permissoes.filter((x) => !quemPede!.permissoes.has(x as Permissao));
  if (faltando.length && !quemPede!.desenvolvedor) throw forbidden('Você não pode dar um perfil com permissões que você não tem.');
  return perfilId;
}

usuariosRouter.get('/', h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.setor, u.situacao, u.todas_unidades, u.admin_inicial, u.deve_trocar_senha,
            u.ultimo_login_em, u.criado_em, p.id AS perfil_id, p.nome AS perfil_nome, p.chave AS perfil_chave,
            u.bloqueado_ate > now() AS bloqueado_por_erros,
            COALESCE(array_agg(uu.unidade_id) FILTER (WHERE uu.unidade_id IS NOT NULL), '{}') AS unidades
       FROM usuarios u JOIN perfis p ON p.id = u.perfil_id LEFT JOIN usuario_unidades uu ON uu.usuario_id = u.id
      WHERE u.excluido_em IS NULL GROUP BY u.id, p.id ORDER BY u.nome`,
  );
  res.json(rows.map((u) => ({
    id: u.id, nome: u.nome, email: u.email, setor: u.setor, situacao: u.situacao, todasUnidades: u.todas_unidades,
    adminInicial: u.admin_inicial, deveTrocarSenha: u.deve_trocar_senha, ultimoLoginEm: u.ultimo_login_em,
    criadoEm: u.criado_em, perfil: { id: u.perfil_id, nome: u.perfil_nome, chave: u.perfil_chave },
    bloqueadoPorErros: Boolean(u.bloqueado_por_erros), unidades: u.unidades,
  })));
}));

/**
 * Cria um usuário. Com SMTP configurado, a pessoa recebe um link para criar a senha.
 * Sem SMTP (instalação), o administrador define uma senha inicial, trocada no primeiro login.
 */
usuariosRouter.post('/', h(async (req, res) => {
  const body = parse(dadosUsuario.extend({ senhaInicial: z.string().max(128).optional() }), req.body);
  const perfilId = await perfilFinal(body.perfilId, body.email, req.usuario);
  const comEmail = await smtpConfigurado();
  if (!comEmail) {
    if (!body.senhaInicial) throw badRequest('O e-mail ainda não foi configurado: informe uma senha inicial.');
    const erro = validarSenha(body.senhaInicial);
    if (erro) throw badRequest(erro);
  }
  const existe = await pool.query('SELECT 1 FROM usuarios WHERE lower(email) = $1 AND excluido_em IS NULL', [body.email]);
  if (existe.rowCount) throw conflict('Já existe um usuário com este e-mail.');

  const novo = await transaction(async (db) => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO usuarios (nome, email, perfil_id, setor, todas_unidades, senha_hash, deve_trocar_senha, criado_por)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
      [body.nome, body.email, perfilId, isDeveloperEmail(body.email) ? 'TI' : body.setor ?? null,
        body.todasUnidades || isDeveloperEmail(body.email), body.senhaInicial && !comEmail ? await hashSenha(body.senhaInicial) : null, req.usuario!.id],
    );
    await gravarUnidades(db, r.rows[0].id, body.todasUnidades ? [] : body.unidades);
    await auditarReq(req, { acao: 'usuario.criado', resultado: 'sucesso', item: { tipo: 'usuario', id: r.rows[0].id, nome: body.email }, detalhes: { perfilId, setor: body.setor, todasUnidades: body.todasUnidades, unidades: body.unidades.length } }, db);
    return r.rows[0];
  });
  let emailEnviado = false;
  if (comEmail) {
    try {
      await enviarLinkDeSenha({ id: novo.id, nome: body.nome, email: body.email }, true);
      emailEnviado = true;
    } catch (err) {
      console.error('[usuarios] falha ao enviar convite', err);
    }
  }
  res.status(201).json({ id: novo.id, emailEnviado });
}));

usuariosRouter.put('/:id', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(dadosUsuario, req.body);
  const atual = await pool.query('SELECT email, admin_inicial FROM usuarios WHERE id = $1 AND excluido_em IS NULL', [id]);
  if (!atual.rowCount) throw notFound('Usuário não encontrado.');
  if (atual.rows[0].email.toLowerCase() !== body.email) {
    const existe = await pool.query('SELECT 1 FROM usuarios WHERE lower(email) = $1 AND excluido_em IS NULL AND id <> $2', [body.email, id]);
    if (existe.rowCount) throw conflict('Já existe um usuário com este e-mail.');
  }
  const perfilId = await perfilFinal(body.perfilId, body.email, req.usuario);
  await transaction(async (db) => {
    await db.query(
      `UPDATE usuarios SET nome = $2, email = $3, perfil_id = $4, setor = $5, todas_unidades = $6, atualizado_em = now() WHERE id = $1`,
      [id, body.nome, body.email, perfilId, isDeveloperEmail(body.email) ? 'TI' : body.setor ?? null, body.todasUnidades || isDeveloperEmail(body.email)],
    );
    await gravarUnidades(db, id, body.todasUnidades ? [] : body.unidades);
    await auditarReq(req, { acao: 'usuario.alterado', resultado: 'sucesso', item: { tipo: 'usuario', id, nome: body.email }, detalhes: { perfilId, setor: body.setor, todasUnidades: body.todasUnidades, unidades: body.unidades.length } }, db);
  });
  res.json({ ok: true });
}));

async function gravarUnidades(db: PoolClient, usuarioId: string, unidades: string[]) {
  await db.query('DELETE FROM usuario_unidades WHERE usuario_id = $1', [usuarioId]);
  if (!unidades.length) return;
  const validas = await db.query<{ id: string }>('SELECT id FROM unidades WHERE id = ANY($1) AND excluido_em IS NULL', [unidades]);
  if (validas.rowCount !== new Set(unidades).size) throw badRequest('Uma das unidades escolhidas não existe.');
  await db.query('INSERT INTO usuario_unidades (usuario_id, unidade_id) SELECT $1, unnest($2::uuid[])', [usuarioId, [...new Set(unidades)]]);
}

usuariosRouter.post('/:id/bloquear', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (id === req.usuario!.id) throw badRequest('Você não pode bloquear o próprio acesso.');
  const r = await pool.query<{ email: string }>(`UPDATE usuarios SET situacao = 'bloqueado', atualizado_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING email`, [id]);
  if (!r.rowCount) throw notFound('Usuário não encontrado.');
  await encerrarSessoesDoUsuario(id, 'usuario_bloqueado'); // perde todas as sessões na hora
  await auditarReq(req, { acao: 'usuario.bloqueado', resultado: 'sucesso', item: { tipo: 'usuario', id, nome: r.rows[0].email } });
  res.json({ ok: true });
}));

usuariosRouter.post('/:id/desbloquear', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const r = await pool.query<{ email: string }>(`UPDATE usuarios SET situacao = 'ativo', tentativas_falhas = 0, bloqueado_ate = NULL, atualizado_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING email`, [id]);
  if (!r.rowCount) throw notFound('Usuário não encontrado.');
  await auditarReq(req, { acao: 'usuario.desbloqueado', resultado: 'sucesso', item: { tipo: 'usuario', id, nome: r.rows[0].email } });
  res.json({ ok: true });
}));

usuariosRouter.post('/:id/enviar-redefinicao', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (!(await smtpConfigurado())) throw badRequest('O e-mail ainda não foi configurado.');
  const { rows } = await pool.query('SELECT id, nome, email FROM usuarios WHERE id = $1 AND excluido_em IS NULL', [id]);
  if (!rows[0]) throw notFound('Usuário não encontrado.');
  await enviarLinkDeSenha(rows[0], false);
  await auditarReq(req, { acao: 'senha.link_enviado', resultado: 'sucesso', item: { tipo: 'usuario', id, nome: rows[0].email }, detalhes: { pedidoPor: 'administrador' } });
  res.json({ ok: true });
}));

usuariosRouter.delete('/:id', h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (id === req.usuario!.id) throw badRequest('Você não pode excluir o próprio usuário.');
  const r = await pool.query<{ email: string }>(`UPDATE usuarios SET excluido_em = now(), situacao = 'bloqueado' WHERE id = $1 AND excluido_em IS NULL RETURNING email`, [id]);
  if (!r.rowCount) throw notFound('Usuário não encontrado.');
  await encerrarSessoesDoUsuario(id, 'usuario_excluido');
  await auditarReq(req, { acao: 'usuario.excluido', resultado: 'sucesso', item: { tipo: 'usuario', id, nome: r.rows[0].email } });
  res.json({ ok: true });
}));

// ═══════════════════════ Perfis ═══════════════════════
export const perfisRouter = Router();
perfisRouter.use(exigirLogin());

perfisRouter.get('/', exigirPermissao('usuarios.gerenciar'), h(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.chave, p.nome, p.descricao, p.sistema, p.permissoes,
            (SELECT count(*)::int FROM usuarios u WHERE u.perfil_id = p.id AND u.excluido_em IS NULL) AS usuarios
       FROM perfis p ORDER BY p.sistema DESC, p.nome`,
  );
  res.json(rows);
}));

const dadosPerfil = z.object({
  nome: z.string().trim().min(2).max(80),
  descricao: z.string().trim().max(255).nullable().optional(),
  permissoes: z.array(z.enum(TODAS_PERMISSOES as [Permissao, ...Permissao[]])).max(100),
});

perfisRouter.post('/', exigirPermissao('perfis.gerenciar'), h(async (req, res) => {
  const body = parse(dadosPerfil, req.body);
  const chave = `personalizado_${Date.now().toString(36)}`;
  const r = await pool.query<{ id: string }>('INSERT INTO perfis (chave, nome, descricao, permissoes) VALUES ($1, $2, $3, $4) RETURNING id', [chave, body.nome, body.descricao ?? null, body.permissoes]);
  await auditarReq(req, { acao: 'perfil.criado', resultado: 'sucesso', item: { tipo: 'perfil', id: r.rows[0].id, nome: body.nome }, detalhes: { permissoes: body.permissoes } });
  res.status(201).json({ id: r.rows[0].id });
}));

perfisRouter.put('/:id', exigirPermissao('perfis.gerenciar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(dadosPerfil, req.body);
  const { rows } = await pool.query<{ chave: string; permissoes: string[] }>('SELECT chave, permissoes FROM perfis WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Perfil não encontrado.');
  if (rows[0].chave === 'desenvolvedor') throw badRequest('O perfil Desenvolvedor sempre tem todas as permissões.');
  if (rows[0].chave === 'diretoria' && !req.usuario!.desenvolvedor) throw forbidden('Só o Desenvolvedor altera o perfil da Diretoria.');
  await pool.query('UPDATE perfis SET nome = $2, descricao = $3, permissoes = $4, atualizado_em = now() WHERE id = $1', [id, body.nome, body.descricao ?? null, body.permissoes]);
  await auditarReq(req, { acao: 'perfil.permissoes_alteradas', resultado: 'sucesso', item: { tipo: 'perfil', id, nome: body.nome }, detalhes: { antes: rows[0].permissoes, depois: body.permissoes } });
  res.json({ ok: true });
}));

perfisRouter.delete('/:id', exigirPermissao('perfis.gerenciar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const { rows } = await pool.query('SELECT nome, sistema FROM perfis WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Perfil não encontrado.');
  if (rows[0].sistema) throw badRequest('Perfis do sistema não podem ser excluídos.');
  const emUso = await pool.query('SELECT 1 FROM usuarios WHERE perfil_id = $1 AND excluido_em IS NULL LIMIT 1', [id]);
  if (emUso.rowCount) throw conflict('Há usuários com este perfil. Troque o perfil deles antes de excluir.');
  await pool.query('DELETE FROM perfis WHERE id = $1', [id]);
  await auditarReq(req, { acao: 'perfil.excluido', resultado: 'sucesso', item: { tipo: 'perfil', id, nome: rows[0].nome } });
  res.json({ ok: true });
}));

// ═══════════════════════ Unidades ═══════════════════════
export const unidadesRouter = Router();

const dadosUnidade = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da unidade.').max(120),
  codigo: z.string().trim().max(32).nullable().optional(),
  ativa: z.boolean().default(true),
});

// Leitura: qualquer pessoa logada vê as unidades a que tem acesso; chave de API com escopo unidades.ler vê todas.
unidadesRouter.get('/', exigirLogin({ aceitaChaveApi: true }), h(async (req, res) => {
  const u = req.usuario!;
  const todas = u.todasUnidades || u.permissoes.has('unidades.gerenciar');
  const { rows } = await pool.query(
    `SELECT id, nome, codigo, ativa, criado_em FROM unidades
      WHERE excluido_em IS NULL AND ($1::boolean OR id = ANY($2::uuid[])) ORDER BY nome`,
    [todas, u.unidades],
  );
  res.json(rows.map((r) => ({ id: r.id, nome: r.nome, codigo: r.codigo, ativa: r.ativa, criadoEm: r.criado_em })));
}));

unidadesRouter.post('/', exigirLogin(), exigirPermissao('unidades.gerenciar'), h(async (req, res) => {
  const body = parse(dadosUnidade, req.body);
  try {
    const r = await pool.query<{ id: string }>('INSERT INTO unidades (nome, codigo, ativa, criado_por) VALUES ($1, $2, $3, $4) RETURNING id', [body.nome, body.codigo || null, body.ativa, req.usuario!.id]);
    await auditarReq(req, { acao: 'unidade.criada', resultado: 'sucesso', item: { tipo: 'unidade', id: r.rows[0].id, nome: body.nome }, detalhes: { codigo: body.codigo } });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('Já existe uma unidade com este nome ou código.');
    throw err;
  }
}));

unidadesRouter.put('/:id', exigirLogin(), exigirPermissao('unidades.gerenciar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(dadosUnidade, req.body);
  try {
    const r = await pool.query('UPDATE unidades SET nome = $2, codigo = $3, ativa = $4, atualizado_em = now() WHERE id = $1 AND excluido_em IS NULL', [id, body.nome, body.codigo || null, body.ativa]);
    if (!r.rowCount) throw notFound('Unidade não encontrada.');
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw conflict('Já existe uma unidade com este nome ou código.');
    throw err;
  }
  await auditarReq(req, { acao: 'unidade.alterada', resultado: 'sucesso', item: { tipo: 'unidade', id, nome: body.nome }, detalhes: body });
  res.json({ ok: true });
}));

unidadesRouter.delete('/:id', exigirLogin(), exigirPermissao('unidades.gerenciar'), h(async (req, res) => {
  const id = parse(uuid, req.params.id);
  // A partir da etapa 3: unidade com candidatos não é excluída, apenas desativada.
  const r = await pool.query<{ nome: string }>('UPDATE unidades SET excluido_em = now(), ativa = false WHERE id = $1 AND excluido_em IS NULL RETURNING nome', [id]);
  if (!r.rowCount) throw notFound('Unidade não encontrada.');
  await pool.query('DELETE FROM usuario_unidades WHERE unidade_id = $1', [id]);
  await auditarReq(req, { acao: 'unidade.excluida', resultado: 'sucesso', item: { tipo: 'unidade', id, nome: r.rows[0].nome } });
  res.json({ ok: true });
}));
