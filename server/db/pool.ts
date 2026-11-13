import pg from 'pg';
import { env } from '../config/env.ts';

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 15,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => console.error('[db] erro em conexão ociosa', err.message));

export type Db = pg.Pool | pg.PoolClient;

/** Executa `fn` dentro de uma transação. Erro em qualquer ponto desfaz tudo. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Saúde do banco para /api/health e para a tela Sistema. */
export async function dbHealth(): Promise<{ conectado: boolean; latenciaMs: number | null }> {
  const inicio = Date.now();
  try {
    await pool.query('SELECT 1');
    return { conectado: true, latenciaMs: Date.now() - inicio };
  } catch {
    return { conectado: false, latenciaMs: null };
  }
}
