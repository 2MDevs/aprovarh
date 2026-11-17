import { CARD, gatilhoDo, validarFluxo, type Fluxo, type No, type Problema } from '@shared/automacoes';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Code2, FlaskConical, History, Library, Pause, Pencil, Play, Redo2, Rocket, Save, Undo2, Workflow, X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Aviso, Botao, Campo, Carregando, Confirmar, ErroCarregar, Modal, SemPermissao, Selo, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { dataHora, relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { Biblioteca } from './Biblioteca';
import { Canvas, type CanvasApi, type Selecao } from './Canvas';
import { SITUACAO_AUTOMACAO } from './estilo';
import { Execucoes } from './Execucoes';
import { grade, novoId } from './geometria';
import { descreverNo, PainelCard } from './PainelCard';
import { ModalCodigo } from './Codigo';
import { ModalTeste } from './Teste';
import type { AutomacaoDetalhe, Opcoes, Versao } from './tipos';

type Aba = 'fluxo' | 'execucoes' | 'versoes';

export function EditorAutomacao() {
  const { id = '' } = useParams();
  const { pode } = useSessao();
  if (!pode('automacoes.ver')) return <SemPermissao />;
  return <Editor key={id} id={id} />;
}

function Editor({ id }: { id: string }) {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  const aba = (['execucoes', 'versoes'].includes(params.get('aba') ?? '') ? params.get('aba') : 'fluxo') as Aba;
  const execucaoAberta = params.get('execucao');
  const dados = useDados<AutomacaoDetalhe>(`/api/automacoes/${id}`);
  const opcoes = useDados<Opcoes>('/api/automacoes/opcoes');
  const avisar = useAviso();
  const podeEditar = pode('automacoes.editar');
  const podePublicar = pode('automacoes.publicar');

  const [fluxo, setFluxo] = useState<Fluxo | null>(null);
  const [info, setInfo] = useState<{ nome: string; descricao: string; unidades: string[] | null } | null>(null);
  const [sujo, setSujo] = useState(false);
  const historico = useRef<{ antes: Fluxo[]; depois: Fluxo[] }>({ antes: [], depois: [] });
  const [selecao, setSelecao] = useState<Selecao | null>(null);
  const [destaque, setDestaque] = useState<Set<string> | null>(null);
  const [biblioteca, setBiblioteca] = useState(() => window.innerWidth >= 1024); // no celular começa fechada
  const [validacaoAberta, setValidacaoAberta] = useState(false);
  const [testando, setTestando] = useState(false);
  const [codigo, setCodigo] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const [salvando, setSalvando] = useState<'salvar' | 'publicar' | 'situacao' | null>(null);
  const [confirmarPublicar, setConfirmarPublicar] = useState(false);
  const canvas = useRef<CanvasApi>(null);

  // Carga inicial (e depois de publicar): o rascunho do servidor vira o estado da tela.
  useEffect(() => {
    if (dados.dados && !sujo) {
      setFluxo(dados.dados.fluxo);
      setInfo({ nome: dados.dados.nome, descricao: dados.dados.descricao ?? '', unidades: dados.dados.unidades });
    }
  }, [dados.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  // Aviso ao sair com alterações não salvas.
  useEffect(() => {
    if (!sujo) return;
    const antes = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [sujo]);

  const mudar = useCallback((f: Fluxo) => {
    setFluxo((atual) => {
      if (atual) {
        historico.current.antes = [...historico.current.antes.slice(-49), atual];
        historico.current.depois = [];
      }
      return f;
    });
    setSujo(true);
    setDestaque(null);
  }, []);

  const desfazer = useCallback(() => {
    const h = historico.current;
    const anterior = h.antes.pop();
    if (!anterior) return;
    setFluxo((atual) => { if (atual) h.depois.push(atual); return anterior; });
    setSujo(true);
  }, []);
  const refazer = useCallback(() => {
    const h = historico.current;
    const proximo = h.depois.pop();
    if (!proximo) return;
    setFluxo((atual) => { if (atual) h.antes.push(atual); return proximo; });
    setSujo(true);
  }, []);

  const contexto = useMemo(() => opcoes.dados && ({
    statusIds: opcoes.dados.status.map((s) => s.id), tagIds: opcoes.dados.tags.map((t) => t.id), unidadeIds: opcoes.dados.unidades.map((u) => u.id),
    whatsappConfigurado: opcoes.dados.whatsapp.configurado, provedor: opcoes.dados.whatsapp.provedor,
  }), [opcoes.dados]);
  const problemas = useMemo(() => (fluxo ? validarFluxo(fluxo, contexto ?? {}) : []), [fluxo, contexto]);
  const porNo = useMemo(() => {
    const m = new Map<string, Problema[]>();
    for (const p of problemas) if (p.noId) m.set(p.noId, [...(m.get(p.noId) ?? []), p]);
    return m;
  }, [problemas]);
  const erros = problemas.filter((p) => !p.aviso);
  const avisos = problemas.filter((p) => p.aviso);

  const excluirSelecao = useCallback(() => {
    if (!fluxo || !selecao || !podeEditar) return;
    if (selecao.tipo === 'no') mudar({ nos: fluxo.nos.filter((n) => n.id !== selecao.id), ligacoes: fluxo.ligacoes.filter((l) => l.de !== selecao.id && l.para !== selecao.id) });
    else mudar({ ...fluxo, ligacoes: fluxo.ligacoes.filter((l) => l.id !== selecao.id) });
    setSelecao(null);
  }, [fluxo, selecao, podeEditar, mudar]);

  const duplicarSelecao = useCallback(() => {
    if (!fluxo || selecao?.tipo !== 'no' || !podeEditar) return;
    const n = fluxo.nos.find((x) => x.id === selecao.id);
    if (!n || CARD[n.tipo]?.categoria === 'gatilho') return;
    const copia: No = { ...n, id: novoId(fluxo, n.tipo), params: structuredClone(n.params), posicao: { x: grade(n.posicao.x + 32), y: grade(n.posicao.y + 32) } };
    mudar({ ...fluxo, nos: [...fluxo.nos, copia] });
    setSelecao({ tipo: 'no', id: copia.id });
  }, [fluxo, selecao, podeEditar, mudar]);

  const salvar = useCallback(async (silencioso = false) => {
    if (!fluxo || !info) return false;
    setSalvando('salvar');
    try {
      await api.put(`/api/automacoes/${id}`, { nome: info.nome, descricao: info.descricao || null, unidades: info.unidades, fluxo });
      setSujo(false);
      if (!silencioso) avisar('Rascunho salvo.');
      await dados.recarregar();
      return true;
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível salvar.', 'erro');
      return false;
    } finally {
      setSalvando(null);
    }
  }, [fluxo, info, id, avisar, dados]);

  // Atalhos de teclado (fora dos campos de texto).
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      const emCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || alvo.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (podeEditar && sujo) void salvar(); return; }
      if (emCampo || aba !== 'fluxo' || !podeEditar) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selecao) { e.preventDefault(); excluirSelecao(); }
      else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); desfazer(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); refazer(); }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicarSelecao(); }
      else if (e.key === 'Escape') setSelecao(null);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [selecao, sujo, aba, podeEditar, excluirSelecao, duplicarSelecao, desfazer, refazer, salvar]);

  const publicar = async () => {
    setConfirmarPublicar(false);
    if (sujo && !(await salvar(true))) return;
    setSalvando('publicar');
    try {
      const r = await api.post<{ versao: number }>(`/api/automacoes/${id}/publicar`);
      avisar(`Versão ${r.versao} publicada. A automação está ativa.`);
      await dados.recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível publicar.', 'erro');
      setValidacaoAberta(true);
    } finally {
      setSalvando(null);
    }
  };

  const mudarSituacao = async (acao: 'ativar' | 'pausar') => {
    setSalvando('situacao');
    try {
      await api.post(`/api/automacoes/${id}/${acao}`);
      avisar(acao === 'ativar' ? 'Automação ativada.' : 'Automação pausada. Nada novo começa, e as execuções em andamento ficam paradas.');
      await dados.recarregar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível.', 'erro');
    } finally {
      setSalvando(null);
    }
  };

  const mudarParams = useCallback((m: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(m)) { if (v === null) p.delete(k); else p.set(k, v); }
    setParams(p, { replace: true });
  }, [params, setParams]);

  // Link do aviso "Automação com erro" (?execucao=...): abre direto o histórico com a execução.
  useEffect(() => {
    if (execucaoAberta && aba === 'fluxo') mudarParams({ aba: 'execucoes' });
  }, [execucaoAberta, aba, mudarParams]);

  if (dados.erro && !dados.dados) return <div className="p-6"><ErroCarregar mensagem={dados.erro.message} onTentar={dados.recarregar} /></div>;
  if (!dados.dados || !fluxo || !info) return <Carregando />;
  const a = dados.dados;
  const sit = SITUACAO_AUTOMACAO[a.situacao] ?? SITUACAO_AUTOMACAO.rascunho;
  const versaoAtual = a.versoes.find((v) => v.atual);
  const descrever = (n: No) => descreverNo(n, opcoes.dados);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de cima */}
      <header className="flex flex-wrap items-center gap-2 border-b border-borda bg-superficie px-3 py-2">
        <Link to="/automacoes" className="grid size-10 place-items-center rounded-full hover:bg-superficie-2" aria-label="Voltar para as automações"><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-bold">{info.nome}</h1>
            {podeEditar && <button onClick={() => setDetalhes(true)} className="grid size-8 place-items-center rounded-full text-suave hover:bg-superficie-2" aria-label="Editar nome, descrição e unidades"><Pencil className="size-4" /></button>}
            <Selo tom={sit.tom}>{sit.rotulo}</Selo>
          </div>
          <p className="truncate text-xs text-suave">
            {versaoAtual ? `Versão ${versaoAtual.numero} publicada ${relativo(versaoAtual.publicadaEm)}` : 'Ainda não publicada'}
            {sujo ? ' · alterações não salvas' : a.rascunhoDiferente && versaoAtual ? ' · rascunho com mudanças ainda não publicadas' : ''}
          </p>
        </div>
        <nav className="flex rounded-full border border-borda p-0.5" aria-label="Seções">
          {([['fluxo', 'Fluxo', Workflow], ['execucoes', 'Execuções', Play], ['versoes', 'Versões', History]] as const).map(([k, rotulo, Icone]) => (
            <button key={k} onClick={() => mudarParams({ aba: k === 'fluxo' ? null : k, execucao: null })} aria-current={aba === k ? 'page' : undefined}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${aba === k ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'text-suave hover:text-texto'}`}>
              <Icone className="size-4" /><span className="hidden sm:inline">{rotulo}</span>
            </button>
          ))}
        </nav>
        {aba === 'fluxo' && (
          <div className="flex flex-wrap items-center gap-1.5">
            {podeEditar && (
              <>
                <Botao variante="fantasma" className="!px-3" aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={desfazer} disabled={!historico.current.antes.length} icone={<Undo2 className="size-4" />} />
                <Botao variante="fantasma" className="!px-3" aria-label="Refazer (Ctrl+Y)" title="Refazer (Ctrl+Y)" onClick={refazer} disabled={!historico.current.depois.length} icone={<Redo2 className="size-4" />} />
                <Botao variante="secundario" aria-label="Salvar rascunho" icone={<Save className="size-4" />} carregando={salvando === 'salvar'} disabled={!sujo} onClick={() => void salvar()}><span className="hidden sm:inline">Salvar rascunho</span></Botao>
              </>
            )}
            <Botao variante="secundario" aria-label="Código (IA)" title="Pedir o fluxo para uma IA e colar o código" icone={<Code2 className="size-4" />} disabled={!opcoes.dados} onClick={() => setCodigo(true)}><span className="hidden sm:inline">Código</span></Botao>
            <Botao variante="secundario" aria-label="Testar" icone={<FlaskConical className="size-4" />} disabled={!opcoes.dados || !gatilhoDo(fluxo)} onClick={() => setTestando(true)}><span className="hidden sm:inline">Testar</span></Botao>
            {podePublicar && (
              <>
                {a.versoes.length > 0 && (a.situacao === 'pausada'
                  ? <Botao variante="secundario" icone={<Play className="size-4" />} carregando={salvando === 'situacao'} onClick={() => void mudarSituacao('ativar')}><span className="hidden sm:inline">Ativar</span></Botao>
                  : <Botao variante="secundario" icone={<Pause className="size-4" />} carregando={salvando === 'situacao'} onClick={() => void mudarSituacao('pausar')}><span className="hidden sm:inline">Pausar</span></Botao>)}
                <Botao aria-label="Publicar" icone={<Rocket className="size-4" />} carregando={salvando === 'publicar'} disabled={erros.length > 0 || (!sujo && !a.rascunhoDiferente)}
                  title={erros.length ? 'Corrija os problemas antes de publicar' : undefined} onClick={() => setConfirmarPublicar(true)}><span className="hidden sm:inline">Publicar</span></Botao>
              </>
            )}
          </div>
        )}
      </header>

      {aba === 'execucoes' && <div className="min-h-0 flex-1 overflow-y-auto"><Execucoes automacaoId={id} aberta={execucaoAberta} onAbrir={(x) => mudarParams({ execucao: x })} /></div>}
      {aba === 'versoes' && <Versoes automacaoId={id} versoes={a.versoes} podeEditar={podeEditar} onUsar={(f) => { mudar(f); mudarParams({ aba: null }); avisar('Versão copiada para o rascunho. Salve para guardar.'); }} />}

      {aba === 'fluxo' && (
        <div className="relative flex min-h-0 flex-1">
          {/* Biblioteca */}
          {podeEditar && biblioteca && (
            <aside className="absolute inset-y-0 left-0 z-20 w-72 border-r border-borda bg-superficie shadow-xl lg:static lg:shadow-none" aria-label="Biblioteca de cards">
              <div className="flex items-center justify-between border-b border-borda px-3 py-2 lg:hidden">
                <span className="font-semibold">Biblioteca</span>
                <button onClick={() => setBiblioteca(false)} className="grid size-9 place-items-center rounded-full hover:bg-superficie-2" aria-label="Fechar biblioteca"><X className="size-4" /></button>
              </div>
              <Biblioteca temGatilho={Boolean(gatilhoDo(fluxo))} whatsappConfigurado={Boolean(opcoes.dados?.whatsapp.configurado)}
                onAdicionar={(tipo) => { canvas.current?.adicionar(tipo); if (window.innerWidth < 1024) setBiblioteca(false); }} />
            </aside>
          )}

          {/* Área */}
          <div className="relative min-w-0 flex-1">
            <Canvas ref={canvas} fluxo={fluxo} onChange={podeEditar ? mudar : undefined} selecionado={selecao} onSelecionar={setSelecao}
              problemas={porNo} destaque={destaque} descrever={descrever} onAviso={(t) => avisar(t, 'erro')} />

            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              <div className="pointer-events-auto flex flex-wrap gap-2">
                {podeEditar && !biblioteca && <Botao variante="secundario" icone={<Library className="size-4" />} onClick={() => setBiblioteca(true)}>Biblioteca</Botao>}
                <button onClick={() => setValidacaoAberta((v) => !v)} aria-expanded={validacaoAberta}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold shadow-sm ${erros.length ? 'border-vermelho/50 bg-vermelho text-white' : 'border-borda bg-superficie'}`}>
                  {erros.length ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4 text-verde" />}
                  {erros.length ? `${erros.length} problema(s)` : 'Pronto para publicar'}{avisos.length ? ` · ${avisos.length} aviso(s)` : ''}
                  <ChevronDown className={`size-4 transition ${validacaoAberta ? 'rotate-180' : ''}`} />
                </button>
                {destaque && <Botao variante="secundario" icone={<X className="size-4" />} onClick={() => setDestaque(null)}>Limpar destaque</Botao>}
              </div>
              {validacaoAberta && (
                <div className="pointer-events-auto max-h-[50vh] w-[min(420px,100%)] overflow-y-auto rounded-2xl border border-borda bg-superficie p-2 shadow-xl">
                  {!problemas.length && <p className="p-3 text-sm text-suave">Nenhum problema encontrado.</p>}
                  <ul>
                    {[...erros, ...avisos].map((p, i) => (
                      <li key={i}>
                        <button disabled={!p.noId} onClick={() => { if (p.noId) { setSelecao({ tipo: 'no', id: p.noId }); canvas.current?.centralizar(p.noId); } }}
                          className="flex w-full gap-2 rounded-xl px-3 py-2 text-left text-[13px] hover:bg-superficie-2 disabled:cursor-default disabled:hover:bg-transparent">
                          {p.aviso ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amarelo-forte" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-vermelho" />}
                          <span>{p.mensagem}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Configurações do card */}
          {selecao && (
            <aside className="absolute inset-y-0 right-0 z-20 w-full max-w-sm border-l border-borda bg-superficie shadow-xl xl:static xl:w-80 xl:shadow-none" aria-label="Configurações do card">
              <PainelCard fluxo={fluxo} selecao={selecao} opcoes={opcoes.dados} problemas={selecao.tipo === 'no' ? porNo.get(selecao.id) ?? [] : []}
                somenteLeitura={!podeEditar} onChange={mudar} onFechar={() => setSelecao(null)} onExcluir={excluirSelecao} onDuplicar={duplicarSelecao} />
            </aside>
          )}
        </div>
      )}

      {codigo && opcoes.dados && (
        <ModalCodigo fluxo={fluxo} nome={info.nome} opcoes={opcoes.dados} podeEditar={podeEditar}
          onAplicar={(f) => { mudar(f); setSelecao(null); setDestaque(null); }} onFechar={() => setCodigo(false)} />
      )}
      {testando && opcoes.dados && (
        <ModalTeste automacaoId={id} fluxo={fluxo} opcoes={opcoes.dados} onFechar={() => setTestando(false)} onCaminho={(ids) => setDestaque(new Set(ids))} />
      )}
      {detalhes && <ModalDetalhes info={info} opcoes={opcoes.dados} onFechar={() => setDetalhes(false)} onSalvar={(v) => { setInfo(v); setSujo(true); setDetalhes(false); }} />}
      <Confirmar aberto={confirmarPublicar} titulo={versaoAtual ? `Publicar a versão ${(a.versoes[0]?.numero ?? 0) + 1}?` : 'Publicar e ativar?'} rotulo="Publicar"
        texto={<>
          A automação passa a valer para os candidatos {info.unidades?.length ? `de ${info.unidades.length} unidade(s)` : 'de todas as unidades'} assim que o gatilho acontecer.
          {versaoAtual && ' As execuções em andamento terminam na versão em que começaram.'}
          {avisos.length > 0 && ` Há ${avisos.length} aviso(s): confira antes.`}
        </>}
        onCancelar={() => setConfirmarPublicar(false)} onConfirmar={() => void publicar()} />
    </div>
  );
}

function ModalDetalhes({ info, opcoes, onFechar, onSalvar }: {
  info: { nome: string; descricao: string; unidades: string[] | null }; opcoes: Opcoes | null; onFechar: () => void;
  onSalvar: (v: { nome: string; descricao: string; unidades: string[] | null }) => void;
}) {
  const [v, setV] = useState(info);
  const todas = !v.unidades?.length;
  return (
    <Modal aberto onFechar={onFechar} titulo="Dados da automação" largura="max-w-lg"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao disabled={v.nome.trim().length < 2 || (!opcoes?.todasUnidades && todas)} onClick={() => onSalvar({ ...v, nome: v.nome.trim() })}>Aplicar</Botao></>}>
      <div className="space-y-4">
        <Campo rotulo="Nome" value={v.nome} maxLength={120} onChange={(e) => setV({ ...v, nome: e.target.value })} />
        <div>
          <label className="rotulo" htmlFor="desc-aut">Descrição</label>
          <textarea id="desc-aut" className="campo min-h-24" maxLength={500} value={v.descricao} onChange={(e) => setV({ ...v, descricao: e.target.value })} />
        </div>
        <SeletorUnidades opcoes={opcoes} valor={v.unidades} onChange={(u) => setV({ ...v, unidades: u })} />
        <p className="text-[12px] text-suave">As mudanças valem ao salvar o rascunho.</p>
      </div>
    </Modal>
  );
}

export function SeletorUnidades({ opcoes, valor, onChange }: { opcoes: Opcoes | null; valor: string[] | null; onChange: (v: string[] | null) => void }) {
  const todas = !valor?.length;
  return (
    <fieldset>
      <legend className="rotulo">Vale para</legend>
      {opcoes?.todasUnidades && (
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[#1D1D1B]" checked={todas} onChange={(e) => onChange(e.target.checked ? null : [])} /> Todas as unidades
        </label>
      )}
      {(!opcoes?.todasUnidades || !todas) && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-borda p-2">
          {(opcoes?.unidades ?? []).map((u) => (
            <label key={u.id} className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm hover:bg-superficie-2">
              <input type="checkbox" className="size-4 accent-[#1D1D1B]" checked={Boolean(valor?.includes(u.id))}
                onChange={(e) => onChange(e.target.checked ? [...(valor ?? []), u.id] : (valor ?? []).filter((x) => x !== u.id))} />
              {u.nome}
            </label>
          ))}
        </div>
      )}
      {!opcoes?.todasUnidades && todas && <p className="mt-1 text-[12px] text-vermelho">Escolha pelo menos uma unidade.</p>}
    </fieldset>
  );
}

function Versoes({ automacaoId, versoes, podeEditar, onUsar }: { automacaoId: string; versoes: Versao[]; podeEditar: boolean; onUsar: (f: Fluxo) => void }) {
  const [vendo, setVendo] = useState<Versao | null>(null);
  const v = useDados<{ numero: number; fluxo: Fluxo }>(vendo ? `/api/automacoes/${automacaoId}/versoes/${vendo.id}` : null);
  const [sel, setSel] = useState<Selecao | null>(null);
  if (vendo) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-borda bg-superficie-2 px-3 py-2 text-sm">
          <Botao variante="fantasma" icone={<ArrowLeft className="size-4" />} onClick={() => { setVendo(null); setSel(null); }}>Versões</Botao>
          <span className="flex-1">Versão {vendo.numero} · publicada em {dataHora(vendo.publicadaEm)}{vendo.publicadaPor ? ` por ${vendo.publicadaPor}` : ''} · <strong>somente leitura</strong></span>
          {podeEditar && v.dados && <Botao variante="secundario" onClick={() => onUsar(v.dados!.fluxo)}>Usar como rascunho</Botao>}
        </div>
        <div className="relative min-h-0 flex-1">
          {v.carregando || !v.dados ? <Carregando /> : <Canvas fluxo={v.dados.fluxo} selecionado={sel} onSelecionar={setSel} />}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto p-4 lg:p-6">
      {!versoes.length ? <Aviso>Esta automação ainda não foi publicada. Cada publicação cria uma versão que nunca mais muda.</Aviso> : (
        <ul className="cartao divide-y divide-borda">
          {versoes.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span>
                <span className="font-semibold">Versão {x.numero}</span> {x.atual && <Selo tom="verde">Em uso</Selo>}
                <span className="block text-sm text-suave">{dataHora(x.publicadaEm)}{x.publicadaPor ? ` · ${x.publicadaPor}` : ''}</span>
              </span>
              <Botao variante="secundario" onClick={() => setVendo(x)}>Ver</Botao>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
