import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { auditarReq } from '../../core/audit.ts';
import { pool } from '../../db/pool.ts';
import { badRequest, conflict, h, parse } from '../../lib/http.ts';
import { conferirSenha } from '../../lib/password.ts';
import { exigirDesenvolvedor, exigirLogin } from '../../middleware/auth.ts';

/**
 * Botão "Atualizar sistema" (lógica do GitHub, igual ao DocSecure).
 * A API NUNCA executa o deploy: só grava `.update/request`. O serviço systemd `aprovarh-update.path`
 * (instalado por scripts/install-auto-update.sh) roda scripts/update.sh, que baixa, instala, gera o build,
 * reinicia, testa /api/health e volta para a versão anterior se algo falhar.
 */
const run = promisify(execFile);
const APP_DIR = process.cwd();
const STATE_DIR = path.join(APP_DIR, '.update');
const REQUEST_FILE = path.join(STATE_DIR, 'request');
const STATUS_FILE = path.join(STATE_DIR, 'status.json');
const LOG_FILE = path.join(STATE_DIR, 'update.log');
const INSTALLED_FILE = path.join(STATE_DIR, 'installed');

type Commit = { commit: string; curto: string; mensagem: string; data: string } | null;

const lerJson = (f: string) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};

async function git(args: string[]) {
  const { stdout } = await run('git', ['-c', `safe.directory=${APP_DIR}`, ...args], { cwd: APP_DIR, timeout: 15_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  return stdout.trim();
}

async function commitAtual(): Promise<Commit> {
  try {
    const [commit, curto, mensagem, data] = (await git(['log', '-1', '--format=%H%x1f%h%x1f%s%x1f%cI'])).split('\x1f');
    return { commit, curto, mensagem, data };
  } catch {
    return null;
  }
}

const branch = () => lerJson(INSTALLED_FILE)?.branch || 'main';

async function repoGithub() {
  try {
    const m = (await git(['remote', 'get-url', 'origin'])).match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i);
    return m ? { dono: m[1], repo: m[2] } : null;
  } catch {
    return null;
  }
}

async function github(caminho: string) {
  try {
    const r = await fetch(`https://api.github.com${caminho}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'aprovaRH-Atualizador' }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

let cacheUltimo: { em: number; valor: Commit } | null = null;
async function ultimoNoGithub(): Promise<Commit> {
  if (cacheUltimo && Date.now() - cacheUltimo.em < 20_000) return cacheUltimo.valor;
  let valor: Commit = cacheUltimo?.valor ?? null;
  try {
    const sha = (await git(['ls-remote', 'origin', `refs/heads/${branch()}`])).split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/i.test(sha) && sha !== valor?.commit) {
      const repo = await repoGithub();
      const d = repo ? await github(`/repos/${repo.dono}/${repo.repo}/commits/${sha}`) : null;
      valor = { commit: sha, curto: sha.slice(0, 7), mensagem: String(d?.commit?.message || 'Nova versão').split('\n')[0], data: d?.commit?.committer?.date || new Date().toISOString() };
    }
  } catch {
    /* GitHub fora do ar: mantém a última informação */
  }
  cacheUltimo = { em: Date.now(), valor };
  return valor;
}

/** O que muda entre a versão instalada e a do GitHub, usando título e descrição dos Pull Requests. */
async function mudancas(de: string, para: string) {
  const repo = await repoGithub();
  if (!repo) return [];
  const cmp = await github(`/repos/${repo.dono}/${repo.repo}/compare/${de}...${para}`);
  const grupos: { titulo: string; itens: string[]; data: string }[] = [];
  for (const c of [...(cmp?.commits ?? [])].reverse()) {
    const pr = String(c.commit?.message || '').match(/^Merge pull request #(\d+)/);
    if (!pr) continue;
    const d = await github(`/repos/${repo.dono}/${repo.repo}/pulls/${pr[1]}`);
    const itens = String(d?.body || '').split('\n').map((l) => l.trim())
      .filter((l) => /^[-*•]\s+/.test(l) && !/generated with|claude\.ai\/code/i.test(l))
      .map((l) => l.replace(/^[-*•]\s+/, '').replace(/\*\*|`/g, '')).slice(0, 12);
    grupos.push({ titulo: String(d?.title || `Melhoria #${pr[1]}`), itens, data: c.commit?.committer?.date });
  }
  return grupos.slice(0, 15);
}

function emAndamento(): boolean {
  if (fs.existsSync(REQUEST_FILE)) return true;
  const s = lerJson(STATUS_FILE);
  if (s?.state !== 'running') return false;
  const inicio = Date.parse(s.startedAt || '');
  return Number.isFinite(inicio) && Date.now() - inicio < 30 * 60_000; // status "preso" depois de 30 min é ignorado
}

export const atualizacaoRouter = Router();

/** Aviso no sino para TODOS os usuários logados (só o Desenvolvedor aplica). */
atualizacaoRouter.get('/aviso', exigirLogin({ permitirBloqueada: true }), h(async (_req, res) => {
  const [atual, ultimo] = await Promise.all([commitAtual(), ultimoNoGithub()]);
  const disponivel = Boolean(atual && ultimo && atual.commit !== ultimo.commit);
  res.json({ disponivel, emAndamento: emAndamento(), versao: disponivel ? ultimo!.curto : atual?.curto ?? null });
}));

atualizacaoRouter.use(exigirLogin(), exigirDesenvolvedor);

atualizacaoRouter.get('/status', h(async (_req, res) => {
  const [atual, ultimo] = await Promise.all([commitAtual(), ultimoNoGithub()]);
  let log = '';
  try {
    log = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-60).join('\n');
  } catch { /* sem log ainda */ }
  res.json({
    instalado: fs.existsSync(INSTALLED_FILE),
    branch: branch(),
    atual,
    ultimo,
    disponivel: Boolean(atual && ultimo && atual.commit !== ultimo.commit),
    emAndamento: emAndamento(),
    status: lerJson(STATUS_FILE),
    log,
  });
}));

/** Verificar: o que a versão nova traz. */
atualizacaoRouter.post('/verificar', h(async (req, res) => {
  cacheUltimo = null;
  const [atual, ultimo] = await Promise.all([commitAtual(), ultimoNoGithub()]);
  const disponivel = Boolean(atual && ultimo && atual.commit !== ultimo.commit);
  await auditarReq(req, { acao: 'atualizacao.verificada', resultado: 'sucesso', detalhes: { atual: atual?.curto, github: ultimo?.curto, disponivel } });
  res.json({ atual, ultimo, disponivel, mudancas: disponivel ? await mudancas(atual!.commit, ultimo!.commit) : [] });
}));

/** Atualizar: pede a senha de novo e grava o pedido para o serviço da VPS. */
atualizacaoRouter.post('/atualizar', h(async (req, res) => {
  const body = parse(z.object({ senha: z.string().min(1, 'Confirme sua senha.').max(128) }), req.body);
  const { rows } = await pool.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id]);
  if (!(await conferirSenha(body.senha, rows[0]?.senha_hash ?? null))) {
    await auditarReq(req, { acao: 'atualizacao.solicitada', resultado: 'negado', detalhes: { motivo: 'senha incorreta' } });
    throw badRequest('Senha incorreta.', 'senha_incorreta');
  }
  if (!fs.existsSync(INSTALLED_FILE)) {
    throw conflict('A atualização automática ainda não foi instalada nesta VPS. Rode uma vez: sudo bash scripts/install-auto-update.sh');
  }
  if (emAndamento()) throw conflict('Já existe uma atualização em andamento.');
  const atual = await commitAtual();
  fs.writeFileSync(REQUEST_FILE, JSON.stringify({ requestedBy: req.usuario!.email, requestedAt: new Date().toISOString(), fromCommit: atual?.commit }), { mode: 0o664 });
  await auditarReq(req, { acao: 'atualizacao.solicitada', resultado: 'sucesso', detalhes: { de: atual?.curto } });
  res.json({ ok: true });
}));
