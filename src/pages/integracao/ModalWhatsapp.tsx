import { Copy, PlugZap, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Aviso, Botao, Carregando, Modal, Selecao, Selo, SeloSigla, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { CORES } from './cores';
import { CamposGrupo, type ItemConfig, type PropsModal, Rodape, useGrupo, useSalvar } from './Modais';

type Provedor = 'meta' | 'evolution';

interface Situacao {
  provedor: Provedor; configurado: boolean; faltando: string[]; webhook: string;
  fila: Record<string, number>; entrada: { pendentes: number; erros: number; ultimo: string | null };
}
interface Modelo { nome: string; idioma: string; categoria: string; situacao: string; corpo: string | null; variaveis: number; sincronizado_em: string }

/** Campos de cada provedor (o resto do grupo vale para os dois). */
const DO_PROVEDOR: Record<Provedor, (chave: string) => boolean> = {
  meta: (c) => ['phone_number_id', 'waba_id', 'token', 'app_secret', 'verify_token', 'versao_api'].some((k) => c === `whatsapp.${k}`),
  evolution: (c) => c.startsWith('whatsapp.evolution_') || c.startsWith('whatsapp.texto_'),
};
const MODELOS = ['whatsapp.modelo_codigo', 'whatsapp.modelo_entrevista'];
const COMUNS = (c: string) => !DO_PROVEDOR.meta(c) && !DO_PROVEDOR.evolution(c) && !MODELOS.includes(c) && c !== 'whatsapp.provedor';

const FILA: Record<string, string> = { pendente: 'Na fila', enviando: 'Enviando', enviada: 'Enviadas', falhou: 'Falharam' };

export function ModalWhatsapp({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('whatsapp', onErro);
  const s = useSalvar(onErro, onFechar, 'WhatsApp salvo.');
  const situacao = useDados<Situacao>('/api/integracao/whatsapp/situacao');
  const modelos = useDados<Modelo[]>('/api/integracao/whatsapp/modelos');
  const avisar = useAviso();
  const [testando, setTestando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => { if (situacao.erro) onErro(situacao.erro); }, [situacao.erro, onErro]);

  const provedor: Provedor = g.valores['whatsapp.provedor'] === 'evolution' ? 'evolution' : 'meta';
  const escolher = (p: Provedor) => g.setValores((v) => ({ ...v, 'whatsapp.provedor': p }));
  const filtrar = (f: (c: string) => boolean): ItemConfig[] => (g.itens ?? []).filter((i) => f(i.chave));
  const webhook = `${window.location.origin}${provedor === 'meta' ? '/api/webhooks/whatsapp' : '/api/webhooks/evolution'}`;
  const copiar = (t: string) => navigator.clipboard.writeText(t).then(() => avisar('Copiado.'), () => avisar('Não foi possível copiar.', 'erro'));

  const salvarERecarregar = async () => {
    await g.salvar();
    await situacao.recarregar();
  };

  const testar = async () => {
    setTeste(null);
    setTestando(true);
    try {
      await salvarERecarregar(); // testa com o que está na tela
      const r = await api.post<{ texto: string }>('/api/integracao/whatsapp/testar');
      setTeste({ ok: true, texto: r.texto });
    } catch (e) {
      onErro(e);
      setTeste({ ok: false, texto: e instanceof ApiError ? e.message : 'Falhou.' });
    } finally {
      setTestando(false);
    }
  };

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      await salvarERecarregar();
      const r = await api.post<{ total: number }>('/api/integracao/whatsapp/modelos/sincronizar');
      await modelos.recarregar();
      avisar(`${r.total} modelo(s) encontrados na conta da Meta.`);
    } catch (e) {
      onErro(e);
      avisar(e instanceof ApiError ? e.message : 'Não foi possível sincronizar.', 'erro');
    } finally {
      setSincronizando(false);
    }
  };

  const aprovados = (modelos.dados ?? []).filter((m) => m.situacao === 'APPROVED');

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-2xl" titulo="WhatsApp"
      descricao="Códigos de acesso, confirmação de entrevistas e conversas com os candidatos."
      selo={<SeloSigla sigla="WA" cor={CORES.whatsapp} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(salvarERecarregar)} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-6">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}

          {/* Provedor */}
          <fieldset>
            <legend className="rotulo">Provedor</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['meta', 'Meta (oficial)', 'Cloud API do WhatsApp Business. Inicia conversa só com modelo aprovado; cobra por mensagem.'],
                ['evolution', 'Evolution API', 'Instância do WhatsApp Web (QR Code). Texto livre, sem cobrança por mensagem. Não é oficial.'],
              ] as const).map(([id, nome, texto]) => (
                <button key={id} type="button" onClick={() => escolher(id)} aria-pressed={provedor === id}
                  className={`rounded-2xl border p-4 text-left transition ${provedor === id ? 'border-grafite bg-creme ring-2 ring-amarelo dark:border-amarelo dark:bg-amarelo/10' : 'border-borda hover:bg-superficie-2'}`}>
                  <span className="block font-semibold">{nome}</span>
                  <span className="mt-1 block text-[13px] text-suave">{texto}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {provedor === 'evolution' && (
            <Aviso tipo="atencao">
              A Evolution API não é oficial: o WhatsApp pode restringir ou banir o número usado, e não há suporte da Meta.
              Use um número só para o recrutamento (decisão D27).
            </Aviso>
          )}

          {/* Situação */}
          {situacao.dados && (
            <div className="rounded-2xl border border-borda p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Situação</p>
                {situacao.dados.provedor !== provedor
                  ? <Selo tom="amarelo">Salve para trocar o provedor</Selo>
                  : <Selo tom={situacao.dados.configurado ? 'verde' : 'cinza'}>{situacao.dados.configurado ? 'Configurado' : 'Não configurado'}</Selo>}
              </div>
              {situacao.dados.provedor === provedor && situacao.dados.faltando.length > 0 && (
                <div className="mt-2 text-suave">
                  <p>Falta preencher:</p>
                  <ul className="mt-1 list-disc pl-5">{situacao.dados.faltando.map((f) => <li key={f}>{f}</li>)}</ul>
                </div>
              )}
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(FILA).map(([k, rotulo]) => (
                  <div key={k} className="rounded-xl bg-superficie-2 px-3 py-2">
                    <dt className="text-[12px] text-suave">{rotulo} (7 dias)</dt>
                    <dd className="text-lg font-bold">{situacao.dados?.fila[k] ?? 0}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-[13px] text-suave">
                Último evento recebido: {situacao.dados.entrada.ultimo ? dataHora(situacao.dados.entrada.ultimo) : 'nenhum ainda'}
                {situacao.dados.entrada.pendentes > 0 && ` · ${situacao.dados.entrada.pendentes} aguardando processamento`}
                {situacao.dados.entrada.erros > 0 && ` · ${situacao.dados.entrada.erros} com erro (7 dias)`}
              </p>
            </div>
          )}

          {/* Webhook */}
          <div>
            <p className="rotulo">Endereço do webhook</p>
            <div className="flex items-center gap-2">
              <code className="campo flex-1 truncate font-mono text-[13px]">{webhook}</code>
              <Botao variante="secundario" icone={<Copy className="size-4" />} onClick={() => void copiar(webhook)} aria-label="Copiar endereço do webhook">Copiar</Botao>
            </div>
            <p className="mt-1.5 text-[13px] text-suave">
              {provedor === 'meta'
                ? 'Cole na Meta em WhatsApp › Configuração › Webhook, com o token de verificação abaixo, e assine o campo "messages".'
                : 'Configure na instância da Evolution com os eventos MESSAGES_UPSERT e MESSAGES_UPDATE e o cabeçalho x-aprovarh-token. O passo a passo está em docs/WHATSAPP.md.'}
            </p>
          </div>

          {/* Campos do provedor */}
          <section>
            <h3 className="mb-3 font-semibold">{provedor === 'meta' ? 'Dados da Meta' : 'Dados da Evolution API'}</h3>
            <CamposGrupo itens={filtrar(DO_PROVEDOR[provedor]).map(limparRotulo)} valores={g.valores} setValores={g.setValores} />
          </section>

          {/* Modelos (Meta) */}
          {provedor === 'meta' && (
            <section className="rounded-2xl border border-borda p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Modelos aprovados</h3>
                  <p className="text-[13px] text-suave">A Meta só deixa iniciar a conversa com modelo aprovado (categoria Utilidade).</p>
                </div>
                <Botao variante="secundario" icone={<RefreshCw className="size-4" />} carregando={sincronizando} onClick={() => void sincronizar()}>Sincronizar</Botao>
              </div>
              <div className="mt-4 space-y-4">
                {MODELOS.map((chave) => {
                  const atual = g.valores[chave] ?? '';
                  const opcoes = aprovados.map((m) => `${m.nome}|${m.idioma}`);
                  return (
                    <Selecao key={chave} rotulo={chave === 'whatsapp.modelo_codigo' ? 'Modelo do código de acesso ({{1}} nome, {{2}} código, {{3}} link)' : 'Modelo da entrevista ({{1}} data, {{2}} horário, botões SIM e NÃO)'}
                      value={atual} onChange={(e) => g.setValores((v) => ({ ...v, [chave]: e.target.value }))}>
                      <option value="">Não usar</option>
                      {atual && !opcoes.includes(atual) && <option value={atual}>{atual} (não encontrado na conta)</option>}
                      {aprovados.map((m) => (
                        <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>{m.nome} ({m.idioma}, {m.variaveis} variáve{m.variaveis === 1 ? 'l' : 'is'})</option>
                      ))}
                    </Selecao>
                  );
                })}
                {!modelos.carregando && !aprovados.length && <p className="text-[13px] text-suave">Nenhum modelo aprovado ainda. Crie na Meta e use "Sincronizar".</p>}
              </div>
            </section>
          )}

          {/* Teste */}
          <div className="rounded-2xl border border-borda p-4">
            <p className="text-sm font-semibold">Testar conexão</p>
            <p className="text-[13px] text-suave">
              {provedor === 'meta' ? 'Salva e confere o número na Meta.' : 'Salva e confere se a instância está conectada ao WhatsApp.'}
            </p>
            <Botao className="mt-3" variante="secundario" icone={<PlugZap className="size-4" />} carregando={testando} onClick={() => void testar()}>Testar conexão</Botao>
            {teste && <div className="mt-3"><Aviso tipo={teste.ok ? 'info' : 'erro'}>{teste.texto}</Aviso></div>}
          </div>

          {/* Comportamento */}
          <section>
            <h3 className="mb-3 font-semibold">Respostas e envio</h3>
            <CamposGrupo itens={filtrar(COMUNS)} valores={g.valores} setValores={g.setValores} />
          </section>
        </div>
      )}
    </Modal>
  );
}

/** Tira o prefixo "Meta: " / "Evolution: " do rótulo, já que a seção diz o provedor. */
function limparRotulo(i: ItemConfig): ItemConfig {
  return { ...i, rotulo: i.rotulo.replace(/^(Meta|Evolution): /, '') };
}
