import { PlugZap, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Aviso, Botao, Carregando, Modal, Selo, SeloSigla } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { CORES } from './cores';
import { CamposGrupo, type ItemConfig, type PropsModal, Rodape, useGrupo, useSalvar } from './Modais';

interface Situacao {
  configurado: boolean; faltando: string[]; webhook: string;
  fila: Record<string, number>; entrada: { pendentes: number; erros: number; ultimo: string | null };
}

/** D40: por enquanto só a Evolution API. Os campos da Meta continuam no servidor, mas não aparecem aqui. */
const EVOLUTION = (c: string) => ['whatsapp.evolution_url', 'whatsapp.evolution_instancia', 'whatsapp.evolution_apikey'].includes(c);
const TEXTOS = (c: string) => c.startsWith('whatsapp.texto_');
const META = (c: string) => ['phone_number_id', 'waba_id', 'token', 'app_secret', 'verify_token', 'versao_api', 'modelo_codigo', 'modelo_entrevista'].some((k) => c === `whatsapp.${k}`);
const COMUNS = (c: string) => !EVOLUTION(c) && !TEXTOS(c) && !META(c) && c !== 'whatsapp.evolution_webhook_token';

const FILA: Record<string, string> = { pendente: 'Na fila', enviando: 'Enviando', enviada: 'Enviadas', falhou: 'Falharam' };

export function ModalWhatsapp({ onFechar, onErro }: PropsModal) {
  const g = useGrupo('whatsapp', onErro);
  const s = useSalvar(onErro, onFechar, 'WhatsApp salvo.');
  const situacao = useDados<Situacao>('/api/integracao/whatsapp/situacao');
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; texto: string } | null>(null);
  const [indo, setIndo] = useState(false);
  const navegar = useNavigate();

  useEffect(() => { if (situacao.erro) onErro(situacao.erro); }, [situacao.erro, onErro]);

  const filtrar = (f: (c: string) => boolean): ItemConfig[] => (g.itens ?? []).filter((i) => f(i.chave));

  const salvarERecarregar = async () => {
    await g.salvar();
    await situacao.recarregar();
  };

  const irParaConexao = async () => {
    setIndo(true);
    try {
      await g.salvar();
      navegar('/conexao');
    } catch (e) {
      onErro(e);
      setIndo(false);
    }
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

  return (
    <Modal aberto onFechar={onFechar} largura="max-w-2xl" titulo="WhatsApp (Evolution API)"
      descricao="Códigos de acesso, confirmação de entrevistas, automações e conversas com os candidatos."
      selo={<SeloSigla sigla="WA" cor={CORES.whatsapp} />}
      rodape={<Rodape onFechar={onFechar} salvando={s.salvando} onSalvar={() => void s.executar(salvarERecarregar)} />}>
      {g.carregando || !g.itens ? <Carregando /> : (
        <div className="space-y-6">
          {s.erro && <Aviso tipo="erro">{s.erro}</Aviso>}

          <Aviso tipo="atencao">
            A Evolution API não é oficial: o WhatsApp pode restringir ou banir o número usado, e não há suporte da Meta.
            Use um número só para o recrutamento (decisão D27).
          </Aviso>

          {/* Situação */}
          {situacao.dados && (
            <div className="rounded-2xl border border-borda p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Situação</p>
                <Selo tom={situacao.dados.configurado ? 'verde' : 'cinza'}>{situacao.dados.configurado ? 'Configurado' : 'Não configurado'}</Selo>
              </div>
              {situacao.dados.faltando.length > 0 && (
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

          {/* Dados da Evolution */}
          <section>
            <h3 className="mb-1 font-semibold">Servidor da Evolution API</h3>
            <p className="mb-3 text-[13px] text-suave">
              Informe só o endereço e a chave global (apikey) da Evolution. A instância ("aprovarh"), o webhook e o token dele são criados e configurados sozinhos quando você conecta o celular.
            </p>
            <CamposGrupo itens={filtrar(EVOLUTION).map(limparRotulo)} valores={g.valores} setValores={g.setValores} />
          </section>

          {/* Conectar o celular */}
          <div className="rounded-2xl border border-borda p-4">
            <p className="text-sm font-semibold">Conectar o celular</p>
            <p className="text-[13px] text-suave">Salve os dados acima e leia o QR Code na tela "Conexão do WhatsApp".</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Botao icone={<QrCode className="size-4" />} carregando={indo} onClick={() => void irParaConexao()}>Salvar e abrir Conexão do WhatsApp</Botao>
              <Botao variante="secundario" icone={<PlugZap className="size-4" />} carregando={testando} onClick={() => void testar()}>Testar conexão</Botao>
            </div>
            {teste && <div className="mt-3"><Aviso tipo={teste.ok ? 'info' : 'erro'}>{teste.texto}</Aviso></div>}
          </div>

          {/* Textos */}
          <section>
            <h3 className="mb-3 font-semibold">Textos enviados</h3>
            <CamposGrupo itens={filtrar(TEXTOS).map(limparRotulo)} valores={g.valores} setValores={g.setValores} />
          </section>

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
