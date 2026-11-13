import { pool, type Db } from '../db/pool.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';

/**
 * Configurações ajustáveis pela tela Integração.
 * Prioridade: Banco > .env > padrão. Cada valor informa de onde veio.
 * Segredos ficam cifrados no banco e nunca voltam para a tela (só "definido" / mascarado).
 */
type Tipo = 'texto' | 'numero' | 'booleano' | 'segredo' | 'email';

interface Definicao {
  grupo: 'smtp' | 'seguranca' | 'geral';
  rotulo: string;
  tipo: Tipo;
  env?: string;
  padrao?: string;
  min?: number;
  max?: number;
}

export const DEFINICOES = {
  'smtp.host': { grupo: 'smtp', rotulo: 'Servidor SMTP', tipo: 'texto', env: 'SMTP_HOST' },
  'smtp.porta': { grupo: 'smtp', rotulo: 'Porta', tipo: 'numero', env: 'SMTP_PORT', padrao: '587', min: 1, max: 65535 },
  'smtp.seguro': { grupo: 'smtp', rotulo: 'Conexão segura (SSL/TLS direto)', tipo: 'booleano', env: 'SMTP_SECURE', padrao: 'false' },
  'smtp.usuario': { grupo: 'smtp', rotulo: 'Usuário', tipo: 'texto', env: 'SMTP_USER' },
  'smtp.senha': { grupo: 'smtp', rotulo: 'Senha', tipo: 'segredo', env: 'SMTP_PASS' },
  'smtp.remetente': { grupo: 'smtp', rotulo: 'Remetente', tipo: 'texto', env: 'SMTP_FROM' },

  'seguranca.sessao_horas': { grupo: 'seguranca', rotulo: 'Validade da sessão (horas)', tipo: 'numero', env: 'SESSION_TTL_HOURS', padrao: '8', min: 1, max: 72 },
  'seguranca.bloqueio_minutos': { grupo: 'seguranca', rotulo: 'Minutos sem uso para bloquear a tela', tipo: 'numero', env: 'LOCK_IDLE_MINUTES', padrao: '10', min: 1, max: 240 },
  'seguranca.pin_tentativas': { grupo: 'seguranca', rotulo: 'Tentativas de PIN antes de encerrar a sessão', tipo: 'numero', env: 'PIN_MAX_ATTEMPTS', padrao: '5', min: 1, max: 20 },
} as const satisfies Record<string, Definicao>;

export type ChaveConfig = keyof typeof DEFINICOES;
export type Origem = 'banco' | 'env' | 'padrao' | 'nao_definido';

/** Cache curto para não consultar o banco a cada requisição. */
let cache: { em: number; linhas: Map<string, string | null> } | null = null;
const CACHE_MS = 15_000;

async function linhasDoBanco(): Promise<Map<string, string | null>> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.linhas;
  const { rows } = await pool.query<{ chave: string; valor: string | null; segredo: boolean }>(
    'SELECT chave, valor, segredo FROM configuracoes',
  );
  const linhas = new Map<string, string | null>();
  for (const r of rows) {
    let valor = r.valor;
    if (valor && r.segredo) {
      try {
        valor = decrypt(valor);
      } catch {
        console.error(`[config] não foi possível decifrar ${r.chave} (SETTINGS_ENCRYPTION_KEY mudou?)`);
        valor = null;
      }
    }
    linhas.set(r.chave, valor);
  }
  cache = { em: Date.now(), linhas };
  return linhas;
}

export function limparCacheConfig() {
  cache = null;
}

export async function lerConfig(chave: ChaveConfig): Promise<{ valor: string | null; origem: Origem }> {
  const def: Definicao = DEFINICOES[chave];
  const banco = await linhasDoBanco();
  const doBanco = banco.get(chave);
  if (doBanco !== undefined && doBanco !== null && doBanco !== '') return { valor: doBanco, origem: 'banco' };
  const doEnv = def.env ? process.env[def.env] : undefined;
  if (doEnv !== undefined && doEnv !== '') return { valor: doEnv, origem: 'env' };
  if (def.padrao !== undefined) return { valor: def.padrao, origem: 'padrao' };
  return { valor: null, origem: 'nao_definido' };
}

export async function cfg(chave: ChaveConfig): Promise<string | null> {
  return (await lerConfig(chave)).valor;
}

export async function cfgNumero(chave: ChaveConfig): Promise<number> {
  const def: Definicao = DEFINICOES[chave];
  const n = Number(await cfg(chave));
  if (!Number.isFinite(n)) return Number(def.padrao);
  return Math.min(def.max ?? n, Math.max(def.min ?? n, n));
}

export async function cfgBooleano(chave: ChaveConfig): Promise<boolean> {
  return /^(1|true|sim|yes)$/i.test(String(await cfg(chave) ?? ''));
}

/** Versão para a tela: segredos aparecem só como "definido" e com a origem. */
export async function configuracoesDoGrupo(grupo: Definicao['grupo']) {
  const itens = [];
  for (const [chave, def] of Object.entries(DEFINICOES) as [ChaveConfig, Definicao][]) {
    if (def.grupo !== grupo) continue;
    const { valor, origem } = await lerConfig(chave);
    itens.push({
      chave,
      rotulo: def.rotulo,
      tipo: def.tipo,
      origem,
      valor: def.tipo === 'segredo' ? null : valor,
      definido: valor !== null && valor !== '',
      min: def.min,
      max: def.max,
    });
  }
  return itens;
}

/** Grava (ou limpa, com valor vazio/null) uma configuração. Valida tipo e limites. */
export async function gravarConfig(db: Db, chave: ChaveConfig, valor: string | null, usuarioId: string) {
  const def: Definicao = DEFINICOES[chave];
  if (valor !== null && valor !== '') {
    if (def.tipo === 'numero') {
      const n = Number(valor);
      if (!Number.isInteger(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        throw new Error(`${def.rotulo}: informe um número entre ${def.min} e ${def.max}.`);
      }
    }
    if (def.tipo === 'booleano' && !/^(true|false)$/.test(valor)) throw new Error(`${def.rotulo}: valor inválido.`);
    if (valor.length > 500) throw new Error(`${def.rotulo}: valor grande demais.`);
  }
  const segredo = def.tipo === 'segredo';
  const gravado = valor === null || valor === '' ? null : segredo ? encrypt(valor) : valor;
  await db.query(
    `INSERT INTO configuracoes (chave, valor, segredo, atualizado_em, atualizado_por)
     VALUES ($1, $2, $3, now(), $4)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, segredo = EXCLUDED.segredo,
       atualizado_em = now(), atualizado_por = EXCLUDED.atualizado_por`,
    [chave, gravado, segredo, usuarioId],
  );
  limparCacheConfig();
}

export function ehChaveConfig(chave: string): chave is ChaveConfig {
  return Object.hasOwn(DEFINICOES, chave);
}
