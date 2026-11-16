import { Copy, Eye, History, Pause, Pencil, Play, Plus, Search, Sparkles, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Botao, Cabecalho, Campo, Carregando, Confirmar, ErroCarregar, Modal, SemPermissao, Selo, Vazio, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, normalizar, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { SeletorUnidades } from './Editor';
import { SITUACAO_AUTOMACAO } from './estilo';
import type { AutomacaoLista, Opcoes } from './tipos';

const FILTROS = [['', 'Todas'], ['ativa', 'Ativas'], ['rascunho', 'Rascunhos'], ['pausada', 'Pausadas'], ['com_erro', 'Com erro']] as const;

/** Gestão de automações: lista, criar, duplicar, pausar, ativar, excluir e abrir o construtor ou o histórico. */
export function Automacoes() {
  const { pode } = useSessao();
  const navegar = useNavigate();
  const lista = useDados<AutomacaoLista[]>(pode('automacoes.ver') ? '/api/automacoes' : null);
  const opcoes = useDados<Opcoes>(pode('automacoes.ver') ? '/api/automacoes/opcoes' : null);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [criar, setCriar] = useState<'vazia' | 'modelo' | null>(null);
  const [excluir, setExcluir] = useState<AutomacaoLista | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const avisar = useAviso();

  if (!pode('automacoes.ver')) return <SemPermissao />;

  const acao = async (id: string, fn: () => Promise<unknown>, ok: string) => {
    setOcupado(id);
    try {
      await fn();
      avisar(ok);
      await lista.recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível.', 'erro');
    } finally {
      setOcupado(null);
    }
  };

  const itens = (lista.dados ?? []).filter((a) => (!filtro || a.situacao === filtro) && (!busca || normalizar(`${a.nome} ${a.descricao ?? ''}`).includes(normalizar(busca))));

  return (
    <>
      <Cabecalho titulo="Automações" descricao="Fluxos que respondem sozinhos aos candidatos: gatilho, condições, ações e tempo. Teste antes de publicar."
        acoes={pode('automacoes.editar') && <>
          <Botao variante="secundario" icone={<Sparkles className="size-4" />} onClick={() => setCriar('modelo')}>Criar a partir do modelo</Botao>
          <Botao icone={<Plus className="size-4" />} onClick={() => setCriar('vazia')}>Nova automação</Botao>
        </>} />

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTROS.map(([id, rotulo]) => (
            <button key={id} onClick={() => setFiltro(id)}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold ${filtro === id ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda bg-superficie text-suave hover:text-texto'}`}>{rotulo}</button>
          ))}
        </div>
        <label className="relative md:w-72">
          <span className="sr-only">Buscar automação</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar automação" className="campo pl-10" />
        </label>
      </div>

      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /> : !lista.dados?.length ? (
        <Vazio titulo="Nenhuma automação ainda.">Comece pelo modelo "Confirmação de presença na entrevista": ele já vem montado com o exemplo do projeto.</Vazio>
      ) : !itens.length ? <Vazio titulo="Nenhuma automação com esse filtro." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {itens.map((a) => {
            const s = SITUACAO_AUTOMACAO[a.situacao] ?? SITUACAO_AUTOMACAO.rascunho;
            const abrir = (q = '') => navegar(`/automacoes/${a.id}${q}`);
            return (
              <article key={a.id} className="cartao flex flex-col p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-grafite text-amarelo"><Workflow className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-semibold">{a.nome}</h2>
                      <Selo tom={s.tom}>{s.rotulo}</Selo>
                    </div>
                    {a.descricao && <p className="mt-1 line-clamp-2 text-sm text-suave">{a.descricao}</p>}
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                  <div><dt className="text-suave">Gatilho</dt><dd className="font-medium">{a.gatilho ?? '—'}</dd></div>
                  <div><dt className="text-suave">Execuções</dt><dd className="font-medium">{a.execucoes.toLocaleString('pt-BR')}{a.ativas ? ` (${a.ativas} em andamento)` : ''}</dd></div>
                  <div><dt className="text-suave">Última execução</dt><dd className="font-medium">{a.ultimaExecucao ? relativo(a.ultimaExecucao) : 'nunca'}</dd></div>
                  <div><dt className="text-suave">Criada por</dt><dd className="font-medium">{a.criador ?? '—'}</dd></div>
                  <div><dt className="text-suave">Última atualização</dt><dd className="font-medium" title={dataHora(a.atualizadaEm)}>{relativo(a.atualizadaEm)}</dd></div>
                  <div><dt className="text-suave">Versão</dt><dd className="font-medium">{a.versao ? `v${a.versao}` : 'não publicada'}</dd></div>
                </dl>
                {a.comErro > 0 && (
                  <button onClick={() => abrir('?aba=execucoes')} className="mt-3 rounded-xl bg-vermelho/10 px-3 py-2 text-left text-sm font-semibold text-vermelho dark:text-red-300">
                    {a.comErro} execução(ões) com erro: ver e reprocessar
                  </button>
                )}
                <div className="mt-4 flex flex-wrap gap-2 border-t border-borda pt-4">
                  <Botao variante="secundario" icone={pode('automacoes.editar') ? <Pencil className="size-4" /> : <Eye className="size-4" />} onClick={() => abrir()}>{pode('automacoes.editar') ? 'Editar' : 'Ver'}</Botao>
                  <Botao variante="secundario" icone={<History className="size-4" />} onClick={() => abrir('?aba=execucoes')}>Histórico</Botao>
                  {pode('automacoes.editar') && <Botao variante="fantasma" icone={<Copy className="size-4" />} carregando={ocupado === `dup-${a.id}`}
                    onClick={() => void acao(`dup-${a.id}`, async () => { const r = await api.post<{ id: string }>(`/api/automacoes/${a.id}/duplicar`); navegar(`/automacoes/${r.id}`); }, 'Automação duplicada como rascunho.')}>Duplicar</Botao>}
                  {pode('automacoes.publicar') && a.versao && (a.situacao === 'pausada'
                    ? <Botao variante="fantasma" icone={<Play className="size-4" />} carregando={ocupado === a.id} onClick={() => void acao(a.id, () => api.post(`/api/automacoes/${a.id}/ativar`), 'Automação ativada.')}>Ativar</Botao>
                    : <Botao variante="fantasma" icone={<Pause className="size-4" />} carregando={ocupado === a.id} onClick={() => void acao(a.id, () => api.post(`/api/automacoes/${a.id}/pausar`), 'Automação pausada.')}>Pausar</Botao>)}
                  {pode('automacoes.editar') && <Botao variante="fantasma" icone={<Trash2 className="size-4" />} onClick={() => setExcluir(a)}>Excluir</Botao>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {criar && <ModalCriar modelo={criar === 'modelo'} opcoes={opcoes.dados} onFechar={() => setCriar(null)} onCriada={(id) => navegar(`/automacoes/${id}`)} />}
      <Confirmar aberto={Boolean(excluir)} perigo titulo="Excluir a automação?" rotulo="Excluir" carregando={ocupado === excluir?.id}
        texto="Ela some da lista e não dispara mais. O histórico de execuções continua guardado. Se houver execuções em andamento, pause e interrompa antes."
        onCancelar={() => setExcluir(null)}
        onConfirmar={() => excluir && void acao(excluir.id, async () => { await api.del(`/api/automacoes/${excluir.id}`); setExcluir(null); }, 'Automação excluída.')} />
    </>
  );
}

function ModalCriar({ modelo, opcoes, onFechar, onCriada }: { modelo: boolean; opcoes: Opcoes | null; onFechar: () => void; onCriada: (id: string) => void }) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [unidades, setUnidades] = useState<string[] | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const precisaUnidade = !opcoes?.todasUnidades && !unidades?.length;
  const criar = async () => {
    setErro('');
    setEnviando(true);
    try {
      const r = modelo
        ? await api.post<{ id: string }>('/api/automacoes/modelo', { unidades })
        : await api.post<{ id: string }>('/api/automacoes', { nome, descricao: descricao || null, unidades });
      onCriada(r.id);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível criar.');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} largura="max-w-lg" titulo={modelo ? 'Criar a partir do modelo' : 'Nova automação'}
      descricao={modelo ? 'Monta um rascunho com o fluxo de referência: no dia da entrevista, envia o código e pergunta se o candidato confirma. Nada fica ativo até você publicar.' : 'Começa como rascunho. Nada acontece até você publicar.'}
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={enviando} disabled={(!modelo && nome.trim().length < 2) || precisaUnidade} onClick={() => void criar()}>Criar</Botao></>}>
      <div className="space-y-4">
        {erro && <p className="text-sm text-vermelho" role="alert">{erro}</p>}
        {!modelo && (
          <>
            <Campo rotulo="Nome" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Boas-vindas ao novo candidato" />
            <div>
              <label className="rotulo" htmlFor="nova-desc">Descrição (opcional)</label>
              <textarea id="nova-desc" className="campo min-h-20" maxLength={500} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
          </>
        )}
        <SeletorUnidades opcoes={opcoes} valor={unidades} onChange={setUnidades} />
      </div>
    </Modal>
  );
}
