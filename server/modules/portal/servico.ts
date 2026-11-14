import type { PoolClient } from 'pg';
import { auditar, type Ator } from '../../core/audit.ts';
import { publicar } from '../../core/tempoReal.ts';
import { hmac, randomFromAlphabet } from '../../lib/crypto.ts';
import { fimDoDiaEmBrasilia } from '../../lib/datas.ts';

/**
 * Código de acesso ao portal:
 * - 8 caracteres de um alfabeto sem letras e números confusos (sem 0/O, 1/I/L), gerado no servidor
 *   com gerador criptográfico: 31^8 ≈ 852 bilhões de combinações. Nunca usa telefone, CPF ou id;
 * - guardado só como HMAC com chave do servidor (a tela pede só o código, então o hash precisa ser
 *   encontrável; quem copiar o banco sem a chave não consegue testar códigos);
 * - vale até 23:59:59 (Brasília) do dia da liberação; gerar outro revoga o anterior;
 * - expirado ou revogado, nunca volta a valer (o hash é único e a situação não volta para "ativa").
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function gerarCodigo(): string {
  const c = randomFromAlphabet(8, ALFABETO);
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** Normaliza o que o candidato digitou: maiúsculas, sem traço e espaços; O→0 e I/L→1 não existem no alfabeto. */
export function normalizarCodigo(entrada: string): string | null {
  const c = String(entrada ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(c) || [...c].some((ch) => !ALFABETO.includes(ch))) return null;
  return c;
}

export const hashCodigo = (normalizado: string) => hmac(`portal:${normalizado}`);

export interface OrigemLiberacao { tipo: 'usuario' | 'automacao'; usuarioId?: string; execucaoId?: string; ator: Ator }

/** Encerra as sessões do portal de uma liberação. */
async function encerrarSessoes(db: PoolClient, liberacaoId: string, motivo: string) {
  await db.query(`UPDATE sessoes_portal SET encerrada_em = now(), motivo_encerramento = $2 WHERE liberacao_id = $1 AND encerrada_em IS NULL`, [liberacaoId, motivo]);
}

/** Revoga a liberação ativa do candidato (se houver) e encerra as sessões dela. */
export async function revogarAcesso(db: PoolClient, candidatoId: string, unidadeId: string, origem: OrigemLiberacao, motivo: string, ip?: string | null) {
  const r = await db.query<{ id: string }>(
    `UPDATE liberacoes_acesso SET situacao = 'revogada', revogada_em = now(), revogada_por = $2, motivo = $3
      WHERE candidato_id = $1 AND situacao = 'ativa' RETURNING id`,
    [candidatoId, origem.usuarioId ?? null, motivo],
  );
  if (!r.rowCount) return false;
  await encerrarSessoes(db, r.rows[0].id, 'revogada');
  await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['acesso.revogado', candidatoId, JSON.stringify({ liberacaoId: r.rows[0].id, motivo })]);
  await auditar({ acao: 'portal.acesso_revogado', resultado: 'sucesso', item: { tipo: 'candidato', id: candidatoId }, detalhes: { motivo }, ator: origem.ator, ip }, db);
  await publicar(db, { tipo: 'candidato.atualizado', candidatoId, unidadeId });
  return true;
}

/**
 * Libera o acesso do dia: revoga o anterior, gera um código novo e devolve o código em texto
 * (única vez em que ele existe fora do hash, para ser enviado ao candidato).
 */
export async function liberarAcesso(
  db: PoolClient, candidatoId: string, unidadeId: string, origem: OrigemLiberacao,
  opcoes: { permiteArquivo: boolean }, ip?: string | null,
): Promise<{ codigo: string; expiraEm: Date; liberacaoId: string }> {
  await revogarAcesso(db, candidatoId, unidadeId, origem, 'Substituída por um código novo', ip);
  const expiraEm = fimDoDiaEmBrasilia();
  // Colisão de hash é praticamente impossível; ainda assim, tenta de novo se o índice único recusar.
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = gerarCodigo();
    try {
      await db.query('SAVEPOINT gerar_codigo');
      const r = await db.query<{ id: string }>(
        `INSERT INTO liberacoes_acesso (candidato_id, codigo_hash, expira_em, origem, liberada_por, execucao_id, permite_arquivo)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [candidatoId, hashCodigo(normalizarCodigo(codigo)!), expiraEm, origem.tipo, origem.usuarioId ?? null, origem.execucaoId ?? null, opcoes.permiteArquivo],
      );
      await db.query('RELEASE SAVEPOINT gerar_codigo');
      await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['acesso.liberado', candidatoId, JSON.stringify({ liberacaoId: r.rows[0].id, expiraEm })]);
      await auditar({ acao: 'portal.codigo_gerado', resultado: 'sucesso', item: { tipo: 'candidato', id: candidatoId }, detalhes: { expiraEm, permiteArquivo: opcoes.permiteArquivo, origem: origem.tipo }, ator: origem.ator, ip }, db);
      await publicar(db, { tipo: 'candidato.atualizado', candidatoId, unidadeId });
      return { codigo, expiraEm, liberacaoId: r.rows[0].id };
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT gerar_codigo');
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
  throw new Error('Não foi possível gerar um código único.');
}

/** Rotina do Worker: liberações vencidas viram "expirada" e as sessões terminam (a checagem por requisição já barra antes). */
export async function expirarLiberacoes(db: PoolClient): Promise<number> {
  const r = await db.query<{ id: string; candidato_id: string; unidade_id: string }>(
    `UPDATE liberacoes_acesso l SET situacao = 'expirada'
       FROM candidatos c
      WHERE l.candidato_id = c.id AND l.situacao = 'ativa' AND l.expira_em <= now()
      RETURNING l.id, l.candidato_id, c.unidade_id`,
  );
  for (const l of r.rows) {
    await encerrarSessoes(db, l.id, 'expirou');
    await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['acesso.expirado', l.candidato_id, JSON.stringify({ liberacaoId: l.id })]);
    await auditar({ acao: 'portal.acesso_expirado', resultado: 'sucesso', item: { tipo: 'candidato', id: l.candidato_id }, ator: { usuarioNome: 'Sistema' } }, db);
    await publicar(db, { tipo: 'candidato.atualizado', candidatoId: l.candidato_id, unidadeId: l.unidade_id });
  }
  return r.rowCount ?? 0;
}
