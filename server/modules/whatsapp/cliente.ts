import crypto from 'node:crypto';
import { env } from '../../config/env.ts';
import { cfg, gravarConfig } from '../../core/settings.ts';
import { pool } from '../../db/pool.ts';

/**
 * Cliente do WhatsApp.
 * Por enquanto o aprovaRH usa SOMENTE a Evolution API (instância do WhatsApp Web conectada por QR Code) — decisão D40.
 * O código da Meta (Cloud API oficial) continua aqui, desligado, para ser reativado no futuro sem refazer tudo.
 * A Evolution NÃO é oficial: o WhatsApp pode restringir ou banir o número (ver decisão D27).
 * Nada aqui é simulado: sem configuração, as funções recusam com "WhatsApp não configurado".
 */
export class ErroWhatsApp extends Error {
  constructor(message: string, public temporario: boolean, public codigo?: number | string) {
    super(message);
  }
}

export type Provedor = 'meta' | 'evolution';

export async function configWhatsapp() {
  const [phoneId, wabaId, token, appSecret, verifyToken, versao, evoUrl, evoInstancia, evoApikey, evoWebhookToken] = await Promise.all([
    cfg('whatsapp.phone_number_id'), cfg('whatsapp.waba_id'), cfg('whatsapp.token'), cfg('whatsapp.app_secret'),
    cfg('whatsapp.verify_token'), cfg('whatsapp.versao_api'), cfg('whatsapp.evolution_url'), cfg('whatsapp.evolution_instancia'),
    cfg('whatsapp.evolution_apikey'), cfg('whatsapp.evolution_webhook_token'),
  ]);
  return {
    // D40: só Evolution por enquanto. A configuração "whatsapp.provedor" é ignorada.
    provedor: 'evolution' as Provedor,
    meta: { phoneId, wabaId, token, appSecret, verifyToken, versao: versao || 'v26.0' },
    evolution: { url: evoUrl?.replace(/\/+$/, '') ?? null, instancia: evoInstancia, apikey: evoApikey, webhookToken: evoWebhookToken },
  };
}

/** http:// só é aceito para a Evolution rodando na própria VPS (127.0.0.1 / localhost); fora dela, só https://. */
export function urlEvolutionValida(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** O que ainda falta configurar (mostrado na tela). O token do webhook é criado sozinho ao conectar. */
export async function faltandoWhatsapp(): Promise<string[]> {
  const c = await configWhatsapp();
  const f: string[] = [];
  if (!c.evolution.url) f.push('Endereço do servidor da Evolution API');
  else if (!urlEvolutionValida(c.evolution.url)) f.push('O endereço da Evolution API precisa começar com https:// (http:// só para 127.0.0.1, na mesma VPS)');
  if (!c.evolution.instancia) f.push('Nome da instância');
  if (!c.evolution.apikey) f.push('Chave da API (apikey)');
  return f;
}

/** Configurado = os dados da Evolution estão preenchidos. Se o celular está conectado, quem diz é estadoConexao(). */
export async function whatsappConfigurado(): Promise<boolean> {
  return (await faltandoWhatsapp()).length === 0;
}

async function http<T>(url: string, metodo: 'GET' | 'POST' | 'DELETE', cabecalhos: Record<string, string>, corpo?: unknown): Promise<T> {
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

async function evolution<T>(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<T> {
  const c = await configWhatsapp();
  if (!c.evolution.url || !c.evolution.apikey || !c.evolution.instancia) throw new ErroWhatsApp('WhatsApp não configurado.', false, 'nao_configurado');
  if (!urlEvolutionValida(c.evolution.url)) throw new ErroWhatsApp('O endereço da Evolution API precisa usar https:// (http:// só para 127.0.0.1).', false);
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
    if (estado !== 'open') throw new ErroWhatsApp(`A instância respondeu, mas o celular não está conectado (estado: ${estado}). Conecte pela tela "Conexão do WhatsApp".`, false);
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

// ═══════════════════════ Conexão da instância (tela "Conexão do WhatsApp") ═══════════════════════

export type EstadoConexao = 'conectado' | 'conectando' | 'desconectado' | 'sem_instancia';
export interface Conexao { estado: EstadoConexao; numero: string | null; nomePerfil: string | null; instancia: string | null }

const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'];

/** O token secreto do webhook é criado aqui, uma vez, e nunca aparece na tela. */
async function garantirTokenWebhook(usuarioId: string): Promise<string> {
  const atual = (await configWhatsapp()).evolution.webhookToken;
  if (atual) return atual;
  const novo = crypto.randomBytes(32).toString('hex');
  await gravarConfig(pool, 'whatsapp.evolution_webhook_token', novo, usuarioId);
  return novo;
}

function naoExiste(err: unknown) {
  return err instanceof ErroWhatsApp && (err.codigo === 404 || /does not exist|não existe|not found/i.test(err.message));
}

/** Situação da instância na Evolution: conectada, esperando o QR Code, desconectada ou ainda não criada. */
export async function estadoConexao(): Promise<Conexao> {
  const c = await configWhatsapp();
  const base: Conexao = { estado: 'desconectado', numero: null, nomePerfil: null, instancia: c.evolution.instancia };
  let estado: string;
  try {
    const r = await evolution<{ instance?: { state?: string } }>('GET', 'instance/connectionState/{instancia}');
    estado = r.instance?.state ?? 'close';
  } catch (err) {
    if (naoExiste(err)) return { ...base, estado: 'sem_instancia' };
    throw err;
  }
  if (estado !== 'open') return { ...base, estado: estado === 'connecting' ? 'conectando' : 'desconectado' };
  // Número e nome do perfil conectados (informativo: se a versão da Evolution não devolver, fica em branco).
  try {
    const lista = await evolution<Array<{ name?: string; ownerJid?: string; profileName?: string; instance?: { instanceName?: string; owner?: string; profileName?: string } }>>(
      'GET', `instance/fetchInstances?instanceName=${encodeURIComponent(c.evolution.instancia ?? '')}`);
    const i = (Array.isArray(lista) ? lista : []).find((x) => (x.name ?? x.instance?.instanceName) === c.evolution.instancia);
    const jid = i?.ownerJid ?? i?.instance?.owner ?? null;
    const numero = jid ? jid.split('@')[0].replace(/\D/g, '') : '';
    // Guarda o número conectado: é o destino do botão "Confirmar pelo WhatsApp" do formulário.
    if (numero && numero !== (await cfg('whatsapp.numero_recrutamento'))) await gravarConfig(pool, 'whatsapp.numero_recrutamento', numero, null).catch(() => {});
    return { ...base, estado: 'conectado', numero: jid ? jid.split('@')[0].replace(/\D/g, '') || null : null, nomePerfil: i?.profileName ?? i?.instance?.profileName ?? null };
  } catch {
    return { ...base, estado: 'conectado' };
  }
}

/**
 * Prepara a conexão: cria a instância se ainda não existir, aponta o webhook dela para o aprovaRH
 * (com o token secreto) e devolve o QR Code. Se já estiver conectada, só confere o webhook.
 */
export async function conectar(usuarioId: string): Promise<{ estado: EstadoConexao; qrcode: string | null; codigoPareamento: string | null; criada: boolean }> {
  const token = await garantirTokenWebhook(usuarioId);
  const c = await configWhatsapp();
  let criada = false;
  let atual = await estadoConexao();
  if (atual.estado === 'sem_instancia') {
    try {
      await evolution('POST', 'instance/create', { instanceName: c.evolution.instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true });
      criada = true;
    } catch (err) {
      throw new ErroWhatsApp(`A instância "${c.evolution.instancia}" não existe e não foi possível criá-la (${(err as Error).message}). Crie-a no painel da Evolution ou use a chave global (apikey) da Evolution.`, false);
    }
  }
  const url = `${env.APP_URL.replace(/\/+$/, '')}/api/webhooks/evolution`;
  await evolution('POST', 'webhook/set/{instancia}', {
    webhook: { enabled: true, url, byEvents: false, base64: false, headers: { 'x-aprovarh-token': token }, events: EVENTOS_WEBHOOK },
  });
  if (!criada) atual = await estadoConexao();
  if (atual.estado === 'conectado') return { estado: 'conectado', qrcode: null, codigoPareamento: null, criada };
  const r = await evolution<{ base64?: string; code?: string; pairingCode?: string | null; qrcode?: { base64?: string } }>('GET', 'instance/connect/{instancia}');
  const qrcode = r.base64 ?? r.qrcode?.base64 ?? null;
  return { estado: 'conectando', qrcode: qrcode && qrcode.startsWith('data:image/') ? qrcode : null, codigoPareamento: r.pairingCode ?? null, criada };
}

/** Desconecta o celular da instância (o número sai do WhatsApp Web). A instância continua existindo. */
export async function desconectar(): Promise<void> {
  await evolution('DELETE', 'instance/logout/{instancia}');
}
