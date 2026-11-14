import { pool, type Db } from '../db/pool.ts';
import { decrypt, encrypt } from '../lib/crypto.ts';

/**
 * Configurações ajustáveis pela tela Integração.
 * Prioridade: Banco > .env > padrão. Cada valor informa de onde veio.
 * Segredos ficam cifrados no banco e nunca voltam para a tela (só "definido" / mascarado).
 */
type Tipo = 'texto' | 'textoLongo' | 'numero' | 'booleano' | 'segredo' | 'email';

interface Definicao {
  grupo: 'smtp' | 'seguranca' | 'arquivos' | 'privacidade' | 'whatsapp';
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

  // Cadastro público (etapa 3). Valores iniciais propostos na decisão D15.
  'arquivos.curriculo_mb': { grupo: 'arquivos', rotulo: 'Tamanho máximo do currículo (MB)', tipo: 'numero', env: 'CURRICULO_MAX_MB', padrao: '10', min: 1, max: 25 },
  'arquivos.foto_mb': { grupo: 'arquivos', rotulo: 'Tamanho máximo da foto 3x4 (MB)', tipo: 'numero', env: 'FOTO_MAX_MB', padrao: '5', min: 1, max: 15 },

  // Aviso de privacidade (LGPD) mostrado no formulário. Sem ele, o cadastro público fica fechado.
  'privacidade.aviso': { grupo: 'privacidade', rotulo: 'Texto do aviso de privacidade', tipo: 'textoLongo' },
  // WhatsApp: provedor "meta" (Cloud API oficial) ou "evolution" (Evolution API, instância do WhatsApp Web). Número: A definir.
  'whatsapp.provedor': { grupo: 'whatsapp', rotulo: 'Provedor (meta ou evolution)', tipo: 'texto', env: 'WHATSAPP_PROVIDER', padrao: 'meta' },
  'whatsapp.evolution_url': { grupo: 'whatsapp', rotulo: 'Evolution: endereço do servidor (https://...)', tipo: 'texto', env: 'EVOLUTION_URL' },
  'whatsapp.evolution_instancia': { grupo: 'whatsapp', rotulo: 'Evolution: nome da instância', tipo: 'texto', env: 'EVOLUTION_INSTANCE' },
  'whatsapp.evolution_apikey': { grupo: 'whatsapp', rotulo: 'Evolution: chave da API (apikey)', tipo: 'segredo', env: 'EVOLUTION_APIKEY' },
  'whatsapp.evolution_webhook_token': { grupo: 'whatsapp', rotulo: 'Evolution: token do webhook (cabeçalho x-aprovarh-token)', tipo: 'segredo', env: 'EVOLUTION_WEBHOOK_TOKEN' },
  'whatsapp.texto_codigo': { grupo: 'whatsapp', rotulo: 'Evolution: texto do código de acesso ({nome}, {codigo}, {link})', tipo: 'textoLongo',
    padrao: 'Olá, {nome}! Para acompanhar sua candidatura na Hummm! Pizzas, acesse {link} e use o código {codigo}. Ele vale até as 23h59 de hoje.' },
  'whatsapp.texto_entrevista': { grupo: 'whatsapp', rotulo: 'Evolution: texto de confirmação de entrevista ({data}, {horario})', tipo: 'textoLongo',
    padrao: 'Olá! Sua entrevista foi agendada para o dia {data}, às {horario}.\n\nVocê estaria disponível nessa data?\n\nResponda SIM ou NÃO.' },
  'whatsapp.phone_number_id': { grupo: 'whatsapp', rotulo: 'Meta: ID do número (Phone Number ID)', tipo: 'texto', env: 'WHATSAPP_PHONE_NUMBER_ID' },
  'whatsapp.waba_id': { grupo: 'whatsapp', rotulo: 'Meta: ID da conta WhatsApp Business (WABA ID)', tipo: 'texto', env: 'WHATSAPP_WABA_ID' },
  'whatsapp.token': { grupo: 'whatsapp', rotulo: 'Meta: Token de acesso permanente (usuário do sistema)', tipo: 'segredo', env: 'WHATSAPP_TOKEN' },
  'whatsapp.app_secret': { grupo: 'whatsapp', rotulo: 'Meta: Chave secreta do app (App Secret, confere a assinatura do webhook)', tipo: 'segredo', env: 'WHATSAPP_APP_SECRET' },
  'whatsapp.verify_token': { grupo: 'whatsapp', rotulo: 'Meta: Token de verificação do webhook (você escolhe e cola também na Meta)', tipo: 'segredo', env: 'WHATSAPP_VERIFY_TOKEN' },
  'whatsapp.versao_api': { grupo: 'whatsapp', rotulo: 'Meta: Versão da Graph API', tipo: 'texto', env: 'WHATSAPP_API_VERSION', padrao: 'v26.0' },
  'whatsapp.modelo_codigo': { grupo: 'whatsapp', rotulo: 'Meta: modelo do código de acesso, no formato nome|idioma (variáveis: {{1}} nome, {{2}} código, {{3}} link)', tipo: 'texto' },
  'whatsapp.modelo_entrevista': { grupo: 'whatsapp', rotulo: 'Meta: modelo de confirmação de entrevista, no formato nome|idioma (variáveis: {{1}} data, {{2}} horário; botões SIM e NÃO)', tipo: 'texto' },
  'whatsapp.respostas_automaticas': { grupo: 'whatsapp', rotulo: 'Responder SIM/NÃO e datas automaticamente', tipo: 'booleano', padrao: 'true' },
  'whatsapp.palavras_sim': { grupo: 'whatsapp', rotulo: 'Respostas aceitas como SIM (separadas por vírgula; vazio = padrão)', tipo: 'texto' },
  'whatsapp.palavras_nao': { grupo: 'whatsapp', rotulo: 'Respostas aceitas como NÃO (separadas por vírgula; vazio = padrão)', tipo: 'texto' },
  'whatsapp.dias_remarcacao': { grupo: 'whatsapp', rotulo: 'Dias à frente oferecidos para remarcar', tipo: 'numero', padrao: '30', min: 3, max: 120 },
  'whatsapp.max_tentativas': { grupo: 'whatsapp', rotulo: 'Tentativas de envio antes de marcar como falha', tipo: 'numero', padrao: '5', min: 1, max: 10 },

  'privacidade.controlador': { grupo: 'privacidade', rotulo: 'Contato para dúvidas sobre dados (e-mail do encarregado/RH)', tipo: 'texto' },
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
    if (valor.length > (def.tipo === 'textoLongo' ? 20_000 : 500)) throw new Error(`${def.rotulo}: valor grande demais.`);
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
