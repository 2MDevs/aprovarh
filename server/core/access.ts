import { PERFIS_SISTEMA, TODAS_PERMISSOES, type Permissao } from '../../shared/permissoes.ts';
import { isDeveloperEmail } from '../config/env.ts';
import { pool, type Db } from '../db/pool.ts';
import { forbidden } from '../lib/http.ts';
import type { UsuarioContexto } from '../types.d.ts';

/** Monta o contexto de acesso de um usuário: perfil, permissões e unidades. Sempre lido do banco. */
export async function carregarUsuario(usuarioId: string, db: Db = pool): Promise<UsuarioContexto | null> {
  const { rows } = await db.query(
    `SELECT u.id, u.nome, u.email, u.setor, u.todas_unidades, u.admin_inicial, u.deve_trocar_senha, u.situacao,
            u.pin_hash IS NOT NULL AS tem_pin, p.id AS perfil_id, p.chave AS perfil_chave, p.nome AS perfil_nome,
            p.permissoes,
            COALESCE(array_agg(uu.unidade_id) FILTER (WHERE uu.unidade_id IS NOT NULL AND un.excluido_em IS NULL), '{}') AS unidades
       FROM usuarios u
       JOIN perfis p ON p.id = u.perfil_id
       LEFT JOIN usuario_unidades uu ON uu.usuario_id = u.id
       LEFT JOIN unidades un ON un.id = uu.unidade_id
      WHERE u.id = $1 AND u.excluido_em IS NULL
      GROUP BY u.id, p.id`,
    [usuarioId],
  );
  const r = rows[0];
  if (!r || r.situacao !== 'ativo') return null;
  const desenvolvedor = r.perfil_chave === 'desenvolvedor' && isDeveloperEmail(r.email);
  // Perfil Desenvolvedor só vale para e-mails em DEVELOPER_EMAILS. Quem saiu da lista fica sem permissões
  // até o administrador escolher outro perfil.
  const exDesenvolvedor = r.perfil_chave === 'desenvolvedor' && !desenvolvedor;
  const permissoes = new Set<Permissao>(
    desenvolvedor
      ? TODAS_PERMISSOES
      : exDesenvolvedor
        ? []
        : (r.permissoes as string[]).filter((p): p is Permissao => TODAS_PERMISSOES.includes(p as Permissao)),
  );
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    perfilId: r.perfil_id,
    perfilChave: r.perfil_chave,
    perfilNome: r.perfil_nome,
    setor: r.setor,
    permissoes,
    // Desenvolvedor e Diretoria enxergam todas as unidades.
    todasUnidades: r.todas_unidades || desenvolvedor || r.perfil_chave === 'diretoria',
    unidades: r.unidades,
    desenvolvedor,
    adminInicial: r.admin_inicial,
    deveTrocarSenha: r.deve_trocar_senha,
    temPin: r.tem_pin,
  };
}

export function pode(u: UsuarioContexto | undefined, p: Permissao): boolean {
  return Boolean(u?.permissoes.has(p));
}

export function exigir(u: UsuarioContexto | undefined, p: Permissao) {
  if (!pode(u, p)) throw forbidden();
}

/** A pessoa enxerga esta unidade? Usado em toda consulta de candidatos (etapa 3 em diante). */
export function enxergaUnidade(u: UsuarioContexto, unidadeId: string): boolean {
  return u.todasUnidades || u.unidades.includes(unidadeId);
}

/**
 * Filtro SQL de unidade para consultas. Devolve null quando a pessoa vê todas.
 * Uso: `WHERE ($1::uuid[] IS NULL OR c.unidade_id = ANY($1))`.
 */
export function filtroUnidades(u: UsuarioContexto): string[] | null {
  return u.todasUnidades ? null : u.unidades;
}

/** Cria os perfis do sistema na instalação e atualiza a descrição dos existentes, sem mexer nas permissões já ajustadas. */
export async function garantirPerfisSistema(db: Db = pool) {
  for (const [chave, p] of Object.entries(PERFIS_SISTEMA)) {
    await db.query(
      `INSERT INTO perfis (chave, nome, descricao, sistema, permissoes) VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (chave) DO UPDATE SET sistema = true, descricao = EXCLUDED.descricao`,
      [chave, p.nome, p.descricao, p.permissoes],
    );
  }
  // O Desenvolvedor sempre tem todas as permissões, inclusive as que surgirem em versões novas.
  await db.query(`UPDATE perfis SET permissoes = $1, atualizado_em = now() WHERE chave = 'desenvolvedor'`, [TODAS_PERMISSOES]);
}
