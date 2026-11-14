import { Lock, Pencil, Plus, Tag as IconeTag, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Abas, Aviso, Botao, Cabecalho, Campo, Carregando, Confirmar, ErroCarregar, Interruptor, Modal, SemPermissao, Selecao, Selo, useAviso, Vazio } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import { Pilula } from './comum';
import { ROTULO_ETAPA, ROTULO_SITUACAO, type Etapa, type SituacaoEtapa, type StatusItem, type Tag } from './tipos';

const CORES = ['#F6D35C', '#E9A23B', '#EA3324', '#1F7A4D', '#3B82F6', '#6D4FD8', '#DB2777', '#0F766E', '#78716C', '#1D1D1B'];

/** Configurações da Central de RH: status do processo seletivo e tags (independentes entre si). */
export function Configuracoes() {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  if (!pode('candidatos.ver')) return <SemPermissao />;
  const aba = params.get('aba') === 'tags' ? 'tags' : 'status';
  return (
    <>
      <Cabecalho titulo="Configurações" descricao="Status do processo seletivo e tags. Status é a etapa oficial do candidato; tags são marcadores livres." />
      <Abas abas={[{ id: 'status', rotulo: 'Status', icone: <Workflow className="size-4" /> }, { id: 'tags', rotulo: 'Tags', icone: <IconeTag className="size-4" /> }]}
        ativa={aba} onChange={(id) => setParams({ aba: id }, { replace: true })} />
      {!pode('status.configurar') && <div className="mb-4"><Aviso>Você pode ver, mas só quem tem a permissão "Criar e editar status e tags" altera.</Aviso></div>}
      {aba === 'status' ? <ListaStatus /> : <ListaTags />}
    </>
  );
}

function SeletorCor({ valor, onChange }: { valor: string; onChange: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="rotulo">Cor</legend>
      <div className="flex flex-wrap gap-2">
        {CORES.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)} aria-label={`Cor ${c}`} aria-pressed={valor.toLowerCase() === c.toLowerCase()}
            className={`size-9 rounded-full border-2 ${valor.toLowerCase() === c.toLowerCase() ? 'border-texto ring-2 ring-amarelo' : 'border-borda'}`} style={{ background: c }} />
        ))}
      </div>
    </fieldset>
  );
}

function ListaStatus() {
  const { pode } = useSessao();
  const { dados, erro, carregando, recarregar } = useDados<StatusItem[]>('/api/central/config/status');
  const [editando, setEditando] = useState<StatusItem | 'novo' | null>(null);
  const [excluir, setExcluir] = useState<StatusItem | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} />;
  const podeEditar = pode('status.configurar');
  return (
    <div className="space-y-4">
      {podeEditar && <div className="flex justify-end"><Botao icone={<Plus className="size-4" />} onClick={() => setEditando('novo')}>Novo status</Botao></div>}
      <ul className="cartao divide-y divide-borda">
        {dados.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="w-8 text-sm text-suave">{s.ordem}</span>
            <div className="min-w-0 flex-1">
              <Pilula cor={s.cor}>{s.nome}</Pilula>
              <p className="mt-1 text-xs text-suave">No portal: {ROTULO_ETAPA[s.etapaPortal]} · {ROTULO_SITUACAO[s.situacaoPortal]}{s.final ? ' · encerra o processo' : ''} · {s.candidatos} candidato(s)</p>
            </div>
            {s.sistema && <Selo><Lock className="size-3" /> Inicial</Selo>}
            {podeEditar && <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(s)}>Editar</Botao>}
            {podeEditar && !s.sistema && <Botao variante="fantasma" aria-label={`Excluir ${s.nome}`} icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(s)} />}
          </li>
        ))}
      </ul>
      {editando && <FormStatus status={editando === 'novo' ? null : editando} proximaOrdem={Math.max(0, ...dados.map((s) => s.ordem)) + 1} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void recarregar(); }} />}
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir status?" perigo rotulo="Excluir" carregando={ocupado}
        texto={<>O status <strong>{excluir?.nome}</strong> será excluído. Só é possível se nenhum candidato estiver nele.</>}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          setOcupado(true);
          try {
            await api.del(`/api/central/config/status/${excluir!.id}`);
            avisar('Status excluído.');
            setExcluir(null);
            await recarregar();
          } catch (e) {
            avisar(e instanceof ApiError ? e.message : 'Não foi possível excluir.', 'erro');
          } finally {
            setOcupado(false);
          }
        }} />
    </div>
  );
}

function FormStatus({ status, proximaOrdem, onFechar, onSalvo }: { status: StatusItem | null; proximaOrdem: number; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(status?.nome ?? '');
  const [cor, setCor] = useState(status?.cor ?? CORES[4]);
  const [ordem, setOrdem] = useState(String(status?.ordem ?? proximaOrdem));
  const [final, setFinal] = useState(status?.final ?? false);
  const [etapa, setEtapa] = useState<Etapa>(status?.etapaPortal ?? 'analise');
  const [situacao, setSituacao] = useState<SituacaoEtapa>(status?.situacaoPortal ?? 'em_andamento');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const corpo = { nome, cor, ordem: Number(ordem) || 0, final, etapaPortal: etapa, situacaoPortal: situacao };
      if (status) await api.put(`/api/central/config/status/${status.id}`, corpo);
      else await api.post('/api/central/config/status', corpo);
      onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo={status ? 'Editar status' : 'Novo status'}
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={nome.trim().length < 2} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
          <Campo rotulo="Ordem" type="number" min={0} max={999} value={ordem} onChange={(e) => setOrdem(e.target.value)} />
        </div>
        <SeletorCor valor={cor} onChange={setCor} />
        <fieldset className="rounded-2xl border border-borda p-4">
          <legend className="px-1 text-sm font-semibold">Como aparece no portal do candidato</legend>
          <p className="mb-3 text-xs text-suave">O candidato nunca vê o nome do status, só a etapa e a situação.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Selecao rotulo="Etapa" value={etapa} onChange={(e) => setEtapa(e.target.value as Etapa)}>
              {Object.entries(ROTULO_ETAPA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </Selecao>
            <Selecao rotulo="Situação" value={situacao} onChange={(e) => setSituacao(e.target.value as SituacaoEtapa)}>
              {Object.entries(ROTULO_SITUACAO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </Selecao>
          </div>
        </fieldset>
        {status?.sistema ? (
          <p className="text-sm text-suave">{status.final ? 'Este status encerra o processo.' : 'Este status não encerra o processo.'} (Status inicial: não pode ser mudado.)</p>
        ) : (
          <Interruptor ligado={final} onChange={setFinal} rotulo="Encerra o processo" descricao="Como Aprovado e Reprovado. Se a pessoa se candidatar de novo, o processo é reaberto." />
        )}
      </div>
    </Modal>
  );
}

function ListaTags() {
  const { pode } = useSessao();
  const { dados, erro, carregando, recarregar } = useDados<(Tag & { candidatos: number })[]>('/api/central/config/tags');
  const [editando, setEditando] = useState<Tag | 'nova' | null>(null);
  const [excluir, setExcluir] = useState<(Tag & { candidatos: number }) | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <ErroCarregar mensagem={erro?.message ?? 'Sem dados.'} onTentar={recarregar} />;
  const podeEditar = pode('status.configurar');
  return (
    <div className="space-y-4">
      {podeEditar && <div className="flex justify-end"><Botao icone={<Plus className="size-4" />} onClick={() => setEditando('nova')}>Nova tag</Botao></div>}
      {!dados.length ? <Vazio titulo="Nenhuma tag criada.">Exemplos: "Loja: KM32", "Retorno pendente", "Documentação recebida".</Vazio> : (
        <ul className="cartao divide-y divide-borda">
          {dados.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <span className="flex-1"><Pilula cor={t.cor}>{t.nome}</Pilula></span>
              <span className="text-xs text-suave">{t.candidatos} candidato(s)</span>
              {podeEditar && <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(t)}>Editar</Botao>}
              {podeEditar && <Botao variante="fantasma" aria-label={`Excluir ${t.nome}`} icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(t)} />}
            </li>
          ))}
        </ul>
      )}
      {editando && <FormTag tag={editando === 'nova' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void recarregar(); }} />}
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir tag?" perigo rotulo="Excluir" carregando={ocupado}
        texto={<>A tag <strong>{excluir?.nome}</strong> sai de {excluir?.candidatos ?? 0} candidato(s). O histórico de cada um continua mostrando quando ela foi usada.</>}
        onCancelar={() => setExcluir(null)}
        onConfirmar={async () => {
          setOcupado(true);
          try {
            await api.del(`/api/central/config/tags/${excluir!.id}`);
            avisar('Tag excluída.');
            setExcluir(null);
            await recarregar();
          } catch (e) {
            avisar(e instanceof ApiError ? e.message : 'Não foi possível excluir.', 'erro');
          } finally {
            setOcupado(false);
          }
        }} />
    </div>
  );
}

function FormTag({ tag, onFechar, onSalvo }: { tag: Tag | null; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(tag?.nome ?? '');
  const [cor, setCor] = useState(tag?.cor ?? CORES[0]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      if (tag) await api.put(`/api/central/config/tags/${tag.id}`, { nome, cor });
      else await api.post('/api/central/config/tags', { nome, cor });
      onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Modal aberto onFechar={onFechar} titulo={tag ? 'Editar tag' : 'Nova tag'} largura="max-w-md"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!nome.trim()} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} placeholder='Ex.: "Loja: KM32"' />
        <SeletorCor valor={cor} onChange={setCor} />
        <p className="text-sm text-suave">Prévia: <Pilula cor={cor}>{nome || 'Nome da tag'}</Pilula></p>
      </div>
    </Modal>
  );
}
