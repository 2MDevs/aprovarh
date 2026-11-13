import { env } from './config/env.ts';
import { bootstrap } from './core/bootstrap.ts';
import { migrate } from './db/migrate.ts';
import { pool } from './db/pool.ts';
import { criarApp } from './app.ts';
import { iniciarTempoReal } from './core/tempoReal.ts';

async function iniciar() {
  await migrate();
  await bootstrap();
  await iniciarTempoReal();
  const servidor = criarApp().listen(env.PORT, () => {
    console.log(`[aprovaRH] API no ar na porta ${env.PORT} (${env.NODE_ENV})`);
  });
  const encerrar = () => {
    console.log('[aprovaRH] encerrando...');
    servidor.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', encerrar);
  process.on('SIGINT', encerrar);
}

iniciar().catch((err) => {
  console.error('[aprovaRH] não foi possível iniciar:', err);
  process.exit(1);
});
