import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.ts';

/**
 * Aplica as migrations SQL de server/db/migrations em ordem, uma única vez cada.
 * Roda sozinha ao iniciar a API e também por `npm run migrate`.
 * Uma trava (advisory lock) impede que API e Worker apliquem ao mesmo tempo.
 */
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(7240011)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      versao varchar(120) PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ versao: string }>('SELECT versao FROM schema_migrations');
    const feitas = new Set(rows.map((r) => r.versao));
    const arquivos = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (versao) VALUES ($1)', [arquivo]);
        await client.query('COMMIT');
        aplicadas.push(arquivo);
        console.log(`[db] migration aplicada: ${arquivo}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migration ${arquivo}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7240011)').catch(() => {});
    client.release();
  }
  return aplicadas;
}

// `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then((a) => {
      console.log(a.length ? `${a.length} migration(s) aplicada(s).` : 'Banco já está atualizado.');
      return pool.end();
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
