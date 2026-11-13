import type { Request } from 'express';
import { pool, type Db } from '../db/pool.ts';
import { sha256 } from '../lib/crypto.ts';
import { ipDe } from '../lib/http.ts';
import { descreverDispositivo } from '../lib/device.ts';

/**
 * Auditoria imutável: cada registro guarda o hash do anterior (SHA-256).
 * O banco recusa UPDATE, DELETE e TRUNCATE (trigger na migration 001).
 * A gravação usa uma trava de transação para que dois registros nunca usem o mesmo "anterior".
 */
export type Resultado = 'sucesso' | 'negado' | 'bloqueado' | 'falha';

export interface Ator {
  usuarioId?: string | null;
  usuarioNome?: string | null;
  perfil?: string | null;
  setor?: string | null;
  chaveApiNome?: string | null;
}

export interface RegistroAuditoria {
  acao: string;
  resultado: Resultado;
  item?: { tipo: string; id?: string | null; nome?: string | null };
  detalhes?: Record<string, unknown>;
  ator?: Ator;
  ip?: string | null;
  dispositivo?: string | null;
}

const LOCK_ID = 7240012;

/** JSON com chaves ordenadas (o jsonb do PostgreSQL reordena as chaves; o hash não pode depender disso). */
function estavel(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(estavel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, estavel((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

/** Texto canônico usado no hash: mesma ordem de campos sempre. */
function canonico(r: Record<string, unknown>): string {
  return JSON.stringify([
    r.em, r.usuario_id, r.usuario_nome, r.perfil, r.setor, r.chave_api_nome, r.acao,
    r.item_tipo, r.item_id, r.item_nome, estavel(r.detalhes ?? {}), r.resultado, r.ip, r.dispositivo, r.hash_anterior,
  ]);
}

/**
 * Grava um registro. Se `db` for um client de transação, o registro só existe se a transação confirmar
 * (assim a auditoria nunca registra uma ação que foi desfeita).
 */
export async function auditar(registro: RegistroAuditoria, db?: Db): Promise<void> {
  const executar = async (c: Db) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    const ultimo = await c.query<{ hash: string }>('SELECT hash FROM auditoria ORDER BY id DESC LIMIT 1');
    const linha = {
      em: new Date().toISOString(),
      usuario_id: registro.ator?.usuarioId ?? null,
      usuario_nome: registro.ator?.usuarioNome ?? null,
      perfil: registro.ator?.perfil ?? null,
      setor: registro.ator?.setor ?? null,
      chave_api_nome: registro.ator?.chaveApiNome ?? null,
      acao: registro.acao,
      item_tipo: registro.item?.tipo ?? null,
      item_id: registro.item?.id ?? null,
      item_nome: registro.item?.nome?.slice(0, 255) ?? null,
      detalhes: registro.detalhes ?? {},
      resultado: registro.resultado,
      ip: registro.ip ?? null,
      dispositivo: registro.dispositivo?.slice(0, 255) ?? null,
      hash_anterior: ultimo.rows[0]?.hash ?? null,
    };
    const hash = sha256(canonico(linha));
    await c.query(
      `INSERT INTO auditoria (em, usuario_id, usuario_nome, perfil, setor, chave_api_nome, acao, item_tipo, item_id,
         item_nome, detalhes, resultado, ip, dispositivo, hash_anterior, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [linha.em, linha.usuario_id, linha.usuario_nome, linha.perfil, linha.setor, linha.chave_api_nome, linha.acao,
        linha.item_tipo, linha.item_id, linha.item_nome, JSON.stringify(linha.detalhes), linha.resultado, linha.ip,
        linha.dispositivo, linha.hash_anterior, hash],
    );
  };

  if (db && 'release' in db) return executar(db); // já está numa transação
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await executar(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Falha de auditoria nunca pode passar em silêncio.
    console.error('[auditoria] falha ao gravar registro', registro.acao, err);
    throw err;
  } finally {
    client.release();
  }
}

/** Atalho com IP, dispositivo e ator tirados da requisição. */
export function auditarReq(req: Request, registro: Omit<RegistroAuditoria, 'ip' | 'dispositivo' | 'ator'> & { ator?: Ator }, db?: Db) {
  const ator: Ator = registro.ator ?? (req.usuario
    ? {
        usuarioId: req.usuario.id,
        usuarioNome: req.usuario.nome,
        perfil: req.usuario.perfilNome,
        setor: req.usuario.setor,
        chaveApiNome: req.chaveApi?.nome ?? null,
      }
    : {});
  return auditar({ ...registro, ator, ip: ipDe(req), dispositivo: descreverDispositivo(req.get('user-agent')).nome }, db);
}

/** Confere a corrente inteira. Devolve o primeiro registro quebrado, se houver. */
export async function verificarCorrente(): Promise<{ ok: boolean; total: number; quebradoEm?: number }> {
  const client = await pool.connect();
  try {
    let anterior: string | null = null;
    let total = 0;
    const cursorSql = `SELECT id, to_char(em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS em, usuario_id, usuario_nome, perfil, setor,
      chave_api_nome, acao, item_tipo, item_id, item_nome, detalhes, resultado, ip, dispositivo, hash_anterior, hash
      FROM auditoria WHERE id > $1 ORDER BY id LIMIT 5000`;
    let ultimoId = 0;
    for (;;) {
      const { rows } = await client.query(cursorSql, [ultimoId]);
      if (!rows.length) break;
      for (const r of rows) {
        total++;
        if (r.hash_anterior !== anterior || sha256(canonico(r)) !== r.hash) return { ok: false, total, quebradoEm: Number(r.id) };
        anterior = r.hash;
        ultimoId = Number(r.id);
      }
    }
    return { ok: true, total };
  } finally {
    client.release();
  }
}
