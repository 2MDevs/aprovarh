import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.ts';
import { dbHealth } from './db/pool.ts';
import { errorHandler, notFound } from './lib/http.ts';
import { carregarSessao, conferirOrigem } from './middleware/auth.ts';
import { limiteGeral } from './middleware/limits.ts';
import { apiRouter } from './modules/api/routes.ts';
import { atualizacaoRouter } from './modules/atualizacao/routes.ts';
import { auditoriaRouter } from './modules/auditoria/routes.ts';
import { authRouter, contaRouter } from './modules/auth/routes.ts';
import { dispositivosRouter } from './modules/dispositivos/routes.ts';
import { integracaoRouter } from './modules/integracao/routes.ts';
import { notificacoesRouter } from './modules/notificacoes/routes.ts';
import { sistemaRouter } from './modules/sistema/routes.ts';
import { publicoRouter } from './modules/publico/routes.ts';
import { perfisRouter, unidadesRouter, usuariosRouter } from './modules/usuarios/routes.ts';

export function criarApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Público: indicador "Conectado" e verificação do atualizador.
  app.get('/api/health', async (_req, res) => {
    const banco = await dbHealth();
    res.status(banco.conectado ? 200 : 503).json({ ok: banco.conectado, banco: banco.conectado ? 'conectado' : 'fora do ar', latenciaMs: banco.latenciaMs });
  });

  app.use('/api', limiteGeral, conferirOrigem, carregarSessao);
  app.use('/api/publico', publicoRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/conta', contaRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/perfis', perfisRouter);
  app.use('/api/unidades', unidadesRouter);
  app.use('/api/dispositivos', dispositivosRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/sistema', sistemaRouter);
  app.use('/api/sistema/api', apiRouter);
  app.use('/api/integracao', integracaoRouter);
  app.use('/api/atualizacao', atualizacaoRouter);
  app.use('/api/notificacoes', notificacoesRouter);
  app.use('/api', (_req, _res, next) => next(notFound('Rota não encontrada.')));

  // Telas (build do Vite em dist/, a partir da etapa 2B). Sem build, só a API responde.
  const dist = path.resolve('dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, file) => {
      if (file.endsWith('index.html') || file.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
