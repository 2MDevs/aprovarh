import crypto from 'node:crypto';
import { cfg } from '../../core/settings.ts';

/**
 * Cliente do WhatsApp com dois provedores, escolhidos na tela Integração:
 * - "meta": WhatsApp Business Cloud API (oficial). Fora da janela de 24 h só envia modelo aprovado.
 * - "evolution": Evolution API (instância conectada ao WhatsApp Web). Envia texto a qualquer momento,
 *   mas NÃO é oficial: a Meta pode restringir ou banir o número (ver decisão D27).
 * Nada aqui é simulado: sem configuração, as funções recusam com "WhatsApp não configurado".
 */
export class ErroWhatsApp extends Error {
  constructor(message: string, public temporario: boolean, public codigo?: number | string) {
    super(message);
  }
}

export type Provedor = 'meta' | 'evolution';

export async function configWhatsapp() {
  const [provedor, phoneId, wabaId, token, appSecret, verifyToken, versao, evoUrl, evoInstancia, evoApikey, evoWebhookToken] = await Promise.all([
    cfg('whatsapp.provedor'), cfg('whatsapp.phone_number_id'), cfg('whatsapp.waba_id'), cfg('whatsapp.token'), cfg('whatsapp.app_secret'),
    cfg('whatsapp.verify_token'), cfg('whatsapp.versao_api'), cfg('whatsapp.evolution_url'), cfg('whatsapp.evolution_instancia'),
    cfg('whatsapp.evolution_apikey'), cfg('whatsapp.evolution_webhook_token'),
  ]);
  return {
    provedor: (provedor === 'evolution' ? 'evolution' : 'meta') as Provedor,
    meta: { phoneId, wabaId, token, appSecret, verifyToken, versao: versao || 'v26.0' },
    evolution: { url: evoUrl?.replace(/\/+$/, '') ?? null, instancia: evoInstancia, apikey: evoApikey, webhookToken: evoWebhookToken },
  };
}

/** O que ainda falta configurar no provedor escolhido (mostrado na tela, como pede o prompt). */
export async function faltandoWhatsapp(): Promise<string[]> {
  const c = await configWhatsapp();
  const f: string[] = [];
  if (c.provedor === 'meta') {
    if (!c.meta.phoneId) f.push('ID do número (Phone Number ID)');
    if (!c.meta.token) f.push('Token de acesso permanente');
    if (!c.meta.appSecret) f.push('App Secret');
    if (!c.meta.verifyToken) f.push('Token de verificação do webhook');
    if (!(await cfg('whatsapp.modelo_codigo'))) f.push('Modelo do código de acesso (aprovado na Meta)');
    if (!(await cfg('whatsapp.modelo_entrevista'))) f.push('Modelo de confirmação de entrevista (aprovado na Meta)');
  } else {
    if (!c.evolution.url) f.push('Endereço do servidor da Evolution API');
    if (!c.evolution.url?.startsWith('https://')) f.push('O endereço da Evolution API precisa começar com https://');
    if (!c.evolution.instancia) f.push('Nome da instância');
    if (!c.evolution.apikey) f.push('Chave da API (apikey)');
    if (!c.evolution.webhookToken) f.push('Token do webhook');
  }
  return [...new Set(f)];
}

/** Configurado = dá para enviar e receber com o provedor escolhido. Os modelos (Meta) são conferidos no envio. */
export async function whatsappConfigurado(): Promise<boolean> {
  const c = await configWhatsapp();
  if (c.provedor === 'meta') return Boolean(c.meta.phoneId && c.meta.token && c.meta.appSecret && c.meta.verifyToken);
  return Boolean(c.evolution.url?.startsWith('https://') && c.evolution.instancia && c.evolution.apikey && c.evolution.webhookToken);
}

async function http<T>(url: string, metodo: 'GET' | 'POST', cabecalhos: Record<string, string>, corpo?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: metodo,
      headers: { ...cabecalhos, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new ErroWhatsApp(`Sem conexão com o provedor do WhatsApp: ${(err as Error).message}`, true);
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = (dados as { error?: { message?: string; code?: number; error_data?: { details?: string } }; response?: { message?: unknown }; message?: unknown });
    const texto = e.error?.message ?? (e.response?.message ? JSON.stringify(e.response.message) : null) ?? (e.message ? String(e.message) : `HTTP ${resp.status}`);
    // 429 e 5xx são temporários (nova tentativa); o resto (número inválido, modelo recusado, chave errada) não adianta repetir.
    const temporario = resp.status === 429 || resp.status >= 500 || e.error?.code === 130429 || e.error?.code === 131016;
    throw new ErroWhatsApp(`${texto}${e.error?.error_data?.details ? ` (${e.error.error_data.details})` : ''}`.slice(0, 480), temporario, e.error?.code ?? resp.status);
  }
  return dados as T;
}

async function graph<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
  const c = await configWhatsapp();
  if (!c.meta.token) throw new ErroWhatsApp('WhatsApp não configurado.', false, 'nao_configurado');
  return http<T>(`https://graph.facebook.com/${c.meta.versao}/${caminho}`, metodo, { Authorization: `Bearer ${c.meta.token}` }, corpo);
}

async function evolution<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
  const c = await configWhatsapp();
  if (!c.evolution.url || !c.evolution.apikey || !c.evolution.instancia) throw new ErroWhatsApp('WhatsApp não configurado.', false, 'nao_configurado');
  if (!c.evolution.url.startsWith('https://')) throw new ErroWhatsApp('O endereço da Evolution API precisa usar https://.', false);
  return http<T>(`${c.evolution.url}/${caminho.replace('{instancia}', encodeURIComponent(c.evolution.instancia))}`, metodo, { apikey: c.evolution.apikey }, corpo);
}

/** O que enviar. "aviso" = mensagem de uma finalidade (código, entrevista), que vira modelo (Meta) ou texto configurado (Evolution). */
export type ConteudoEnvio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'aviso'; finalidade: 'codigo'; variaveis: { nome: string; codigo: string; link: string } }
  | { tipo: 'aviso'; finalidade: 'entrevista'; variaveis: { data: string; horario: string } };

const ORDEM_META = { codigo: ['nome', 'codigo', 'link'], entrevista: ['data', 'horario'] } as const;

/** "codigo_acesso|pt_BR" → { nome, idioma }. */
async function modeloMeta(finalidade: 'codigo' | 'entrevista') {
  const valor = await cfg(finalidade === 'codigo' ? 'whatsapp.modelo_codigo' : 'whatsapp.modelo_entrevista');
  const [nome, idioma] = (valor ?? '').split('|').map((x) => x.trim());
  if (!nome) throw new ErroWhatsApp(`Modelo de ${finalidade === 'codigo' ? 'código de acesso' : 'entrevista'} não configurado (Integração › WhatsApp).`, false, 'sem_modelo');
  return { nome, idioma: idioma || 'pt_BR' };
}

/** Texto final de um aviso no provedor Evolution (placeholders {nome}, {codigo}...). */
export async function textoDoAviso(c: Extract<ConteudoEnvio, { tipo: 'aviso' }>): Promise<string> {
  const modelo = (await cfg(c.finalidade === 'codigo' ? 'whatsapp.texto_codigo' : 'whatsapp.texto_entrevista')) ?? '';
  return modelo.replace(/\\n/g, '\n').replace(/\{(\w+)\}/g, (_, k: string) => (c.variaveis as Record<string, string>)[k] ?? `{${k}}`);
}

/** Envia e devolve o id da mensagem no provedor. `para` em +55... */
export async function enviar(para: string, conteudo: ConteudoEnvio): Promise<string> {
  const c = await configWhatsapp();
  const numero = para.replace(/^\+/, '');
  if (c.provedor === 'evolution') {
    const texto = conteudo.tipo === 'texto' ? conteudo.texto : await textoDoAviso(conteudo);
    const r = await evolution<{ key?: { id?: string } }>('POST', 'message/sendText/{instancia}', { number: numero, text: texto.slice(0, 4096) });
    const id = r.key?.id;
    if (!id) throw new ErroWhatsApp('A Evolution API não devolveu o id da mensagem.', true);
    return id;
  }
  if (!c.meta.phoneId) throw new ErroWhatsApp('WhatsApp não configurado.', false, 'nao_configurado');
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: numero };
  let corpo: unknown;
  if (conteudo.tipo === 'texto') {
    corpo = { ...base, type: 'text', text: { body: conteudo.texto.slice(0, 4096), preview_url: false } };
  } else {
    const m = await modeloMeta(conteudo.finalidade);
    const vars = ORDEM_META[conteudo.finalidade].map((k) => (conteudo.variaveis as Record<string, string>)[k]);
    corpo = { ...base, type: 'template', template: { name: m.nome, language: { code: m.idioma }, components: [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: v })) }] } };
  }
  const r = await graph<{ messages?: { id: string }[] }>('POST', `${c.meta.phoneId}/messages`, corpo);
  const id = r.messages?.[0]?.id;
  if (!id) throw new ErroWhatsApp('A Meta não devolveu o id da mensagem.', true);
  return id;
}

/** Teste de conexão (tela Integração). */
export async function testarConexao(): Promise<string> {
  const c = await configWhatsapp();
  if (c.provedor === 'evolution') {
    const r = await evolution<{ instance?: { state?: string } }>('GET', 'instance/connectionState/{instancia}');
    const estado = r.instance?.state ?? 'desconhecido';
    if (estado !== 'open') throw new ErroWhatsApp(`A instância respondeu, mas não está conectada ao WhatsApp (estado: ${estado}). Leia o QR Code no painel da Evolution.`, false);
    return `Instância "${c.evolution.instancia}" conectada ao WhatsApp.`;
  }
  if (!c.meta.phoneId) throw new ErroWhatsApp('Informe o ID do número.', false);
  const r = await graph<{ display_phone_number?: string; verified_name?: string; quality_rating?: string }>('GET', `${c.meta.phoneId}?fields=display_phone_number,verified_name,quality_rating`);
  return `Número ${r.display_phone_number ?? '—'} (${r.verified_name ?? 'sem nome verificado'}), qualidade ${r.quality_rating ?? '—'}.`;
}

export interface ModeloMeta { id: string; name: string; language: string; status: string; category: string; components?: { type: string; text?: string; buttons?: { type: string; text: string }[] }[] }

/** Lista os modelos da conta na Meta (todas as páginas). Só para o provedor "meta". */
export async function listarModelos(): Promise<ModeloMeta[]> {
  const c = await configWhatsapp();
  if (!c.meta.wabaId) throw new ErroWhatsApp('Informe o ID da conta (WABA ID).', false);
  const campos = 'fields=id,name,language,status,category,components&limit=100';
  const todos: ModeloMeta[] = [];
  let depois: string | null = null;
  for (let i = 0; i < 20; i++) {
    const r: { data: ModeloMeta[]; paging?: { cursors?: { after?: string }; next?: string } } =
      await graph('GET', `${c.meta.wabaId}/message_templates?${campos}${depois ? `&after=${encodeURIComponent(depois)}` : ''}`);
    todos.push(...r.data);
    depois = r.paging?.next ? r.paging.cursors?.after ?? null : null;
    if (!depois) break;
  }
  return todos;
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, corpo bruto). */
export function assinaturaMetaValida(corpoBruto: Buffer, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const esperado = Buffer.from(crypto.createHmac('sha256', appSecret).update(corpoBruto).digest('hex'));
  const recebido = Buffer.from(cabecalho.slice(7));
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

/** Evolution: token secreto no cabeçalho x-aprovarh-token (configurado no webhook da instância). */
export function tokenEvolutionValido(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
