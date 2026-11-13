import { Copy, KeyRound, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Interruptor, Modal, Selo, useAviso, Vazio } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

interface Chave { id: string; nome: string; inicio: string; escopos: string[]; criadaEm: string; criadaPor: string; ultimoUsoEm: string | null; ultimoUsoIp: string | null; ativa: boolean }
interface WebhookItem { id: string; nome: string; url: string; eventos: string[]; ativo: boolean; ultimo_disparo_em: string | null; ultimo_resultado: string | null }

function Copiar({ texto }: { texto: string }) {
  const avisar = useAviso();
  return (
    <Botao variante="secundario" icone={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(texto).then(() => avisar('Copiado.'), () => avisar('Não foi possível copiar.', 'erro'))}>
      Copiar
    </Botao>
  );
}

export function ApiWebhooks() {
  const chaves = useDados<Chave[]>('/api/sistema/api/chaves');
  const escopos = useDados<{ chave: string; nome: string }[]>('/api/sistema/api/escopos');
  const hooks = useDados<{ eventosDisponiveis: string[]; webhooks: WebhookItem[] }>('/api/sistema/api/webhooks');
  const [novaChave, setNovaChave] = useState(false);
  const [novoHook, setNovoHook] = useState(false);
  const [segredo, setSegredo] = useState<{ titulo: string; valor: string; aviso: string } | null>(null);
  const [revogar, setRevogar] = useState<Chave | null>(null);
  const [excluir, setExcluir] = useState<WebhookItem | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const origem = window.location.origin;

  const acao = async (fn: () => Promise<unknown>, ok: string, depois: () => void) => {
    setOcupado(true);
    try {
      await fn();
      avisar(ok);
      depois();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível concluir.', 'erro');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5" /> Chaves de API</h2>
          <Botao icone={<Plus className="size-4" />} onClick={() => setNovaChave(true)}>Nova chave</Botao>
        </div>
        {chaves.carregando && !chaves.dados ? <Carregando /> : chaves.erro ? <ErroCarregar mensagem={chaves.erro.message} onTentar={chaves.recarregar} /> : !chaves.dados?.length ? (
          <Vazio titulo="Nenhuma chave criada.">Chaves permitem que outro sistema consulte o aprovaRH, com as permissões de quem criou e só nos escopos escolhidos.</Vazio>
        ) : (
          <ul className="cartao divide-y divide-borda">
            {chaves.dados.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{k.nome} <span className="ml-1 font-mono text-xs text-suave">{k.inicio}</span></p>
                  <p className="text-xs text-suave">Criada por {k.criadaPor} em {dataHora(k.criadaEm)} · último uso {relativo(k.ultimoUsoEm)}{k.ultimoUsoIp ? ` (IP ${k.ultimoUsoIp})` : ''} · escopos: {k.escopos.join(', ')}</p>
                </div>
                <Selo tom={k.ativa ? 'verde' : 'cinza'}>{k.ativa ? 'Ativa' : 'Revogada'}</Selo>
                {k.ativa && <Botao variante="secundario" onClick={() => setRevogar(k)}>Revogar</Botao>}
              </li>
            ))}
          </ul>
        )}
        <details className="cartao mt-4 p-5 text-sm">
          <summary className="cursor-pointer font-semibold">Como conectar outro sistema</summary>
          <p className="mt-3 text-suave">Envie a chave no cabeçalho <code>Authorization</code>. Exemplo para listar as unidades (escopo "Ler unidades"):</p>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-grafite p-4 text-xs text-creme">{`curl -H "Authorization: Bearer aprh_live_SUA_CHAVE" \\\n  ${origem}/api/unidades`}</pre>
          <p className="mt-3 text-suave">Login, Sistema, Integração e a própria tela de chaves não aceitam chave de API.</p>
        </details>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Webhook className="size-5" /> Webhooks</h2>
          <Botao icone={<Plus className="size-4" />} onClick={() => setNovoHook(true)}>Novo webhook</Botao>
        </div>
        {hooks.carregando && !hooks.dados ? <Carregando /> : hooks.erro ? <ErroCarregar mensagem={hooks.erro.message} onTentar={hooks.recarregar} /> : !hooks.dados?.webhooks.length ? (
          <Vazio titulo="Nenhum webhook cadastrado.">Webhooks avisam outro sistema quando algo acontece. Os eventos de candidatos chegam nas próximas etapas.</Vazio>
        ) : (
          <ul className="cartao divide-y divide-borda">
            {hooks.dados.webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{w.nome}</p>
                  <p className="truncate font-mono text-xs text-suave">{w.url}</p>
                  <p className="text-xs text-suave">Último disparo: {w.ultimo_disparo_em ? `${dataHora(w.ultimo_disparo_em)} (${w.ultimo_resultado})` : 'nunca'}</p>
                </div>
                <Selo tom={w.ativo ? 'verde' : 'cinza'}>{w.ativo ? 'Ligado' : 'Desligado'}</Selo>
                <Botao variante="secundario" icone={<Send className="size-4" />} carregando={ocupado} onClick={() => void acao(() => api.post(`/api/sistema/api/webhooks/${w.id}/testar`), 'Teste enviado com sucesso.', hooks.recarregar)}>Testar</Botao>
                <Botao variante="fantasma" aria-label="Excluir webhook" icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(w)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {novaChave && (
        <NovaChave escopos={escopos.dados ?? []} onFechar={() => setNovaChave(false)}
          onCriada={(valor, aviso) => { setNovaChave(false); setSegredo({ titulo: 'Chave criada', valor, aviso }); void chaves.recarregar(); }} />
      )}
      {novoHook && (
        <NovoWebhook eventos={hooks.dados?.eventosDisponiveis ?? []} onFechar={() => setNovoHook(false)}
          onCriado={(valor, aviso) => { setNovoHook(false); setSegredo({ titulo: 'Webhook criado', valor, aviso }); void hooks.recarregar(); }} />
      )}
      {segredo && (
        <Modal aberto onFechar={() => setSegredo(null)} titulo={segredo.titulo} rodape={<Botao onClick={() => setSegredo(null)}>Já copiei</Botao>}>
          <div className="space-y-4">
            <Aviso tipo="atencao">{segredo.aviso}</Aviso>
            <p className="break-all rounded-xl bg-grafite p-4 font-mono text-sm text-creme">{segredo.valor}</p>
            <Copiar texto={segredo.valor} />
          </div>
        </Modal>
      )}
      <Confirmar aberto={Boolean(revogar)} titulo="Revogar chave?" perigo rotulo="Revogar" carregando={ocupado}
        texto={<>A chave <strong>{revogar?.nome}</strong> para de funcionar na hora. Não dá para desfazer.</>}
        onCancelar={() => setRevogar(null)}
        onConfirmar={() => void acao(() => api.post(`/api/sistema/api/chaves/${revogar!.id}/revogar`), 'Chave revogada.', () => { setRevogar(null); void chaves.recarregar(); })} />
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir webhook?" perigo rotulo="Excluir" carregando={ocupado}
        texto={<>O webhook <strong>{excluir?.nome}</strong> deixa de receber avisos.</>}
        onCancelar={() => setExcluir(null)}
        onConfirmar={() => void acao(() => api.del(`/api/sistema/api/webhooks/${excluir!.id}`), 'Webhook excluído.', () => { setExcluir(null); void hooks.recarregar(); })} />
    </div>
  );
}

function NovaChave({ escopos, onFechar, onCriada }: { escopos: { chave: string; nome: string }[]; onFechar: () => void; onCriada: (valor: string, aviso: string) => void }) {
  const [nome, setNome] = useState('');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const r = await api.post<{ chave: string; aviso: string }>('/api/sistema/api/chaves', { nome, escopos: marcados });
      onCriada(r.chave, r.aviso);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo="Nova chave de API" descricao="A chave age com as suas permissões, limitada aos escopos escolhidos."
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2 || !marcados.length} onClick={() => void criar()}>Criar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Integração com o Gestão" maxLength={120} />
        <fieldset>
          <legend className="rotulo">Escopos</legend>
          {escopos.map((e) => (
            <label key={e.chave} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-superficie-2">
              <input type="checkbox" className="size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" checked={marcados.includes(e.chave)}
                onChange={() => setMarcados((m) => (m.includes(e.chave) ? m.filter((x) => x !== e.chave) : [...m, e.chave]))} />
              <span className="text-sm">{e.nome}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}

function NovoWebhook({ eventos, onFechar, onCriado }: { eventos: string[]; onFechar: () => void; onCriado: (valor: string, aviso: string) => void }) {
  const [nome, setNome] = useState('');
  const [url, setUrl] = useState('https://');
  const [marcados, setMarcados] = useState<string[]>([]);
  const [ativo, setAtivo] = useState(true);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const criar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const r = await api.post<{ segredo: string; aviso: string }>('/api/sistema/api/webhooks', { nome, url, eventos: marcados, ativo });
      onCriado(r.segredo, r.aviso);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo="Novo webhook" descricao="Só endereços com https://. Cada envio é assinado com um segredo próprio."
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2 || !url.startsWith('https://')} onClick={() => void criar()}>Criar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} />
        <Campo rotulo="Endereço" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        <fieldset>
          <legend className="rotulo">Eventos</legend>
          {eventos.map((ev) => (
            <label key={ev} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-superficie-2">
              <input type="checkbox" className="size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" checked={marcados.includes(ev)}
                onChange={() => setMarcados((m) => (m.includes(ev) ? m.filter((x) => x !== ev) : [...m, ev]))} />
              <span className="font-mono text-sm">{ev}</span>
            </label>
          ))}
        </fieldset>
        <Interruptor ligado={ativo} onChange={setAtivo} rotulo="Ligado" />
      </div>
    </Modal>
  );
}
