import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.ts';
import { auditarReq } from '../../core/audit.ts';
import { dbHealth, pool } from '../../db/pool.ts';
import { h, notFound, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';

const run = promisify(execFile);
const APP_DIR = process.cwd();

/** Tela Sistema (Desenvolvedor e Diretoria). Tudo medido no servidor real; nada inventado. */
export const sistemaRouter = Router();
sistemaRouter.use(exigirLogin(), exigirPermissao('sistema.ver'));

async function tamanhoPasta(dir: string): Promise<number | null> {
  try {
    if (!fs.existsSync(dir)) return 0;
    const { stdout } = await run('du', ['-sb', dir], { timeout: 20_000 });
    return Number(stdout.split(/\s+/)[0]);
  } catch {
    return null;
  }
}

async function discoDoServidor() {
  try {
    const s = await fs.promises.statfs(APP_DIR);
    const total = s.blocks * s.bsize;
    const livre = s.bavail * s.bsize;
    return { total, livre, usado: total - livre };
  } catch {
    return null;
  }
}

let cpuAnterior = { uso: process.cpuUsage(), em: Date.now() };
function cpuDoProjeto(): number {
  const agora = { uso: process.cpuUsage(), em: Date.now() };
  const microseg = agora.uso.user - cpuAnterior.uso.user + (agora.uso.system - cpuAnterior.uso.system);
  const decorrido = (agora.em - cpuAnterior.em) * 1000;
  cpuAnterior = agora;
  return decorrido > 0 ? Math.min(100, (microseg / decorrido / os.cpus().length) * 100) : 0;
}

/** Aba "Recursos da plataforma": o que ESTE projeto usa, comparado com a VPS inteira (compartilhada). */
sistemaRouter.get('/recursos', h(async (_req, res) => {
  const armazenamento = path.resolve(env.STORAGE_DIR);
  const [disco, arquivos, temporarios, aplicacao, banco] = await Promise.all([
    discoDoServidor(),
    tamanhoPasta(path.join(armazenamento, 'arquivos')),
    tamanhoPasta(path.join(armazenamento, 'tmp')),
    tamanhoPasta(APP_DIR),
    pool.query<{ n: string }>('SELECT pg_database_size(current_database())::text AS n').then((r) => Number(r.rows[0].n)).catch(() => null),
  ]);
  const mem = process.memoryUsage();
  res.json({
    projeto: {
      memoria: mem.rss,
      cpuPercentual: Number(cpuDoProjeto().toFixed(1)),
      disco: { arquivos, temporarios, banco, aplicacao },
    },
    servidor: {
      memoriaTotal: os.totalmem(),
      memoriaLivre: os.freemem(),
      disco,
      nucleos: os.cpus().length,
      carga: os.loadavg(),
    },
  });
}));

/** Aba "Servidor": dados reais da VPS e do banco. */
sistemaRouter.get('/servidor', h(async (_req, res) => {
  const [banco, versaoBanco, disco] = await Promise.all([
    dbHealth(),
    pool.query<{ v: string }>('SHOW server_version').then((r) => r.rows[0].v).catch(() => null),
    discoDoServidor(),
  ]);
  res.json({
    hostname: os.hostname(),
    sistema: `${os.type()} ${os.release()}`,
    node: process.version,
    ligadoHaSegundos: Math.round(os.uptime()),
    processoHaSegundos: Math.round(process.uptime()),
    memoriaTotal: os.totalmem(),
    memoriaLivre: os.freemem(),
    nucleos: os.cpus().length,
    carga: os.loadavg(),
    disco,
    banco: { ...banco, versao: versaoBanco },
  });
}));

// ── Artefatos da plataforma (pasta docs/ do repositório) ───────────────────
const DOCS = path.join(APP_DIR, 'docs');
const TIPOS: Record<string, string> = { '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8' };

function listarArtefatos() {
  if (!fs.existsSync(DOCS)) return [];
  return fs.readdirSync(DOCS)
    .filter((f) => TIPOS[path.extname(f).toLowerCase()])
    .map((f) => {
      const st = fs.statSync(path.join(DOCS, f));
      return { arquivo: f, nome: path.basename(f, path.extname(f)), tipo: path.extname(f).slice(1).toUpperCase(), tamanho: st.size, atualizadoEm: st.mtime };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

sistemaRouter.get('/artefatos', h(async (_req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  res.json({ versao: pkg.version, artefatos: listarArtefatos() });
}));

sistemaRouter.get('/artefatos/:arquivo', h(async (req, res) => {
  const arquivo = parse(z.string().regex(/^[\w .()-]+\.(pdf|md)$/i, 'Arquivo inválido.'), req.params.arquivo);
  const existe = listarArtefatos().find((a) => a.arquivo === arquivo);
  if (!existe) throw notFound('Artefato não encontrado.');
  const baixar = req.query.baixar === '1';
  await auditarReq(req, { acao: baixar ? 'artefato.baixado' : 'artefato.visualizado', resultado: 'sucesso', item: { tipo: 'artefato', nome: arquivo } });
  res.setHeader('Content-Type', TIPOS[path.extname(arquivo).toLowerCase()]);
  res.setHeader('Content-Disposition', `${baixar ? 'attachment' : 'inline'}; filename="${encodeURIComponent(arquivo)}"`);
  res.sendFile(path.join(DOCS, arquivo));
}));
