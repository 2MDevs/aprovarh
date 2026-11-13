import { developerEmails, env } from '../config/env.ts';
import { transaction } from '../db/pool.ts';
import { hashSenha, validarSenha } from '../lib/password.ts';
import { garantirPerfisSistema } from './access.ts';
import { auditar } from './audit.ts';

/**
 * Preparação ao iniciar:
 * 1. perfis do sistema;
 * 2. administrador inicial ("usuário fantasma") a partir de ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD,
 *    só se ainda não existir; troca de senha obrigatória no primeiro login;
 * 3. contas cujo e-mail está em DEVELOPER_EMAILS passam a ter o perfil Desenvolvedor (setor TI).
 */
export async function bootstrap() {
  await transaction(async (db) => {
    await garantirPerfisSistema(db);

    if (env.ADMIN_EMAIL && env.ADMIN_INITIAL_PASSWORD) {
      const existe = await db.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1) AND excluido_em IS NULL', [env.ADMIN_EMAIL]);
      if (!existe.rowCount) {
        const erro = validarSenha(env.ADMIN_INITIAL_PASSWORD);
        if (erro) {
          console.error(`[bootstrap] ADMIN_INITIAL_PASSWORD não atende a regra de senha: ${erro}`);
        } else {
          const perfil = await db.query<{ id: string }>(`SELECT id FROM perfis WHERE chave = 'diretoria'`);
          const r = await db.query<{ id: string }>(
            `INSERT INTO usuarios (nome, email, perfil_id, setor, senha_hash, deve_trocar_senha, admin_inicial, todas_unidades)
             VALUES ('Administrador inicial', $1, $2, 'Diretoria', $3, true, true, true) RETURNING id`,
            [env.ADMIN_EMAIL.toLowerCase(), perfil.rows[0].id, await hashSenha(env.ADMIN_INITIAL_PASSWORD)],
          );
          await auditar({ acao: 'usuario.admin_inicial_criado', resultado: 'sucesso', item: { tipo: 'usuario', id: r.rows[0].id, nome: env.ADMIN_EMAIL }, ator: { usuarioNome: 'Sistema' } }, db);
          console.log('[bootstrap] administrador inicial criado. A senha deve ser trocada no primeiro acesso.');
        }
      }
    }

    if (developerEmails.size) {
      const dev = await db.query<{ id: string }>(`SELECT id FROM perfis WHERE chave = 'desenvolvedor'`);
      const promovidos = await db.query<{ id: string; email: string }>(
        `UPDATE usuarios SET perfil_id = $1, setor = 'TI', todas_unidades = true, atualizado_em = now()
          WHERE lower(email) = ANY($2) AND excluido_em IS NULL AND perfil_id <> $1 RETURNING id, email`,
        [dev.rows[0].id, [...developerEmails]],
      );
      for (const u of promovidos.rows) {
        await auditar({ acao: 'usuario.perfil_desenvolvedor', resultado: 'sucesso', item: { tipo: 'usuario', id: u.id, nome: u.email }, detalhes: { origem: 'DEVELOPER_EMAILS' }, ator: { usuarioNome: 'Sistema' } }, db);
      }
    }
  });
}
