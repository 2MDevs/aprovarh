import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Abas, Aviso, Botao, Cabecalho, Campo, Carregando, Confirmar, ErroCarregar, Modal, SemPermissao, Selecao, useAviso, Vazio } from '../../components/ui';
import { api, ApiError, query } from '../../lib/api';
import { useEventos } from '../../lib/eventos';
import { useDados } from '../../lib/useDados';
import { Foto } from '../central/comum';
import { diaLongo, SeloEntrevista } from './comum';

interface Unidade { id: string; nome: string }
interface ItemAgenda {
  id: string; inicioEm: string; duracaoMinutos: number; situacao: string; local: string | null; unidade: Unidade; responsavel: string | null;
  candidato: { id: string; nome: string; codigo: string; fotoId: string | null };
}
interface Disponibilidade {
  id: string; unidade: Unidade; dataInicial: string; dataFinal: string; diasSemana: number[]; horarios: string[]; duracaoMinutos: number;
  vagasPorHorario: number; responsavel: { id: string; nome: string } | null; local: string | null;
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const hojeBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dataBr = (d: string) => d.split('-').reverse().join('/');

export function Entrevistas() {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  const unidades = useDados<Unidade[]>('/api/unidades');
  const [unidadeId, setUnidadeId] = useState('');
  useEffect(() => {
    if (!unidadeId && unidades.dados?.length === 1) setUnidadeId(unidades.dados[0].id);
  }, [unidades.dados, unidadeId]);
  if (!pode('candidatos.ver')) return <SemPermissao />;
  const aba = params.get('aba') === 'disponibilidade' ? 'disponibilidade' : 'agenda';
  return (
    <>
      <Cabecalho titulo="Entrevistas" descricao="Agenda das entrevistas e os dias e horários que cada unidade oferece." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Abas abas={[{ id: 'agenda', rotulo: 'Agenda', icone: <CalendarDays className="size-4" /> }, { id: 'disponibilidade', rotulo: 'Disponibilidade', icone: <CalendarRange className="size-4" /> }]}
          ativa={aba} onChange={(id) => setParams({ aba: id }, { replace: true })} />
        <select className="campo sm:w-64" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} aria-label="Unidade">
          <option value="">{aba === 'agenda' ? 'Todas as unidades' : 'Escolha a unidade'}</option>
          {unidades.dados?.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </div>
      {aba === 'agenda' ? <Agenda unidadeId={unidadeId} /> : unidadeId ? <DisponibilidadeUnidade unidadeId={unidadeId} /> : <Vazio titulo="Escolha a unidade para ver e cadastrar a disponibilidade." />}
    </>
  );
}

function Agenda({ unidadeId }: { unidadeId: string }) {
  const [inicio, setInicio] = useState(hojeBrasilia());
  const fim = somarDias(inicio, 6);
  const lista = useDados<ItemAgenda[]>(`/api/entrevistas${query({ unidadeId, de: inicio, ate: fim })}`);
  useEventos(() => void lista.recarregar());
  const porDia = useMemo(() => {
    const m = new Map<string, ItemAgenda[]>();
    for (const e of lista.dados ?? []) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(e.inicioEm));
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return m;
  }, [lista.dados]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Botao variante="secundario" aria-label="Semana anterior" icone={<ChevronLeft className="size-4" />} onClick={() => setInicio((d) => somarDias(d, -7))} />
        <p className="text-center font-semibold">{dataBr(inicio)} a {dataBr(fim)}</p>
        <div className="flex gap-2">
          {inicio !== hojeBrasilia() && <Botao variante="fantasma" onClick={() => setInicio(hojeBrasilia())}>Hoje</Botao>}
          <Botao variante="secundario" aria-label="Próxima semana" icone={<ChevronRight className="size-4" />} onClick={() => setInicio((d) => somarDias(d, 7))} />
        </div>
      </div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /> : (
        <div className="space-y-4">
          {Array.from({ length: 7 }, (_, i) => somarDias(inicio, i)).map((d) => {
            const itens = porDia.get(d) ?? [];
            return (
              <section key={d}>
                <h2 className="mb-2 text-sm font-bold capitalize text-suave">{diaLongo(d)}</h2>
                {!itens.length ? <p className="rounded-2xl border border-dashed border-borda px-4 py-3 text-sm text-suave">Nenhuma entrevista.</p> : (
                  <ul className="cartao divide-y divide-borda">
                    {itens.map((e) => (
                      <li key={e.id}>
                        <Link to={`/conversas?c=${e.candidato.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-superficie-2">
                          <span className="w-14 text-lg font-bold">{new Date(e.inicioEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</span>
                          <Foto candidatoId={e.candidato.id} fotoId={e.candidato.fotoId} nome={e.candidato.nome} tamanho={36} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{e.candidato.nome}</span>
                            <span className="block text-xs text-suave">{e.unidade.nome}{e.responsavel ? ` · com ${e.responsavel}` : ''} · {e.duracaoMinutos} min</span>
                          </span>
                          <SeloEntrevista situacao={e.situacao} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DisponibilidadeUnidade({ unidadeId }: { unidadeId: string }) {
  const { pode } = useSessao();
  const disp = useDados<Disponibilidade[]>(`/api/entrevistas/disponibilidades${query({ unidadeId })}`);
  const bloq = useDados<{ id: string; data: string; motivo: string | null }[]>(`/api/entrevistas/bloqueios${query({ unidadeId })}`);
  const [editando, setEditando] = useState<Disponibilidade | 'novo' | null>(null);
  const [excluir, setExcluir] = useState<Disponibilidade | null>(null);
  const [novoBloqueio, setNovoBloqueio] = useState({ data: '', motivo: '' });
  const [ocupado, setOcupado] = useState(false);
  const avisar = useAviso();
  const podeEditar = pode('disponibilidade.configurar');

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

  if (disp.carregando && !disp.dados) return <Carregando />;
  if (disp.erro) return <ErroCarregar mensagem={disp.erro.message} onTentar={disp.recarregar} />;
  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Períodos de entrevista</h2>
          {podeEditar && <Botao icone={<Plus className="size-4" />} onClick={() => setEditando('novo')}>Novo período</Botao>}
        </div>
        {!disp.dados?.length ? <Vazio titulo="Nenhum período cadastrado.">Sem período, não é possível agendar entrevistas nesta unidade.</Vazio> : (
          <ul className="space-y-3">
            {disp.dados.map((d) => (
              <li key={d.id} className="cartao p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{dataBr(d.dataInicial)} a {dataBr(d.dataFinal)}</p>
                    <p className="text-sm text-suave">{d.diasSemana.map((n) => DIAS[n]).join(', ')} · {d.duracaoMinutos} min · {d.vagasPorHorario} vaga(s) por horário{d.responsavel ? ` · responsável: ${d.responsavel.nome}` : ''}</p>
                    {d.local && <p className="text-sm text-suave">Local: {d.local}</p>}
                  </div>
                  {podeEditar && (
                    <div className="flex gap-2">
                      <Botao variante="secundario" icone={<Pencil className="size-4" />} onClick={() => setEditando(d)}>Editar</Botao>
                      <Botao variante="fantasma" aria-label="Excluir período" icone={<Trash2 className="size-4 text-vermelho" />} onClick={() => setExcluir(d)} />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{d.horarios.map((h) => <span key={h} className="rounded-lg bg-superficie-2 px-2.5 py-1 text-sm font-semibold">{h}</span>)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Dias bloqueados</h2>
        <p className="mb-3 text-sm text-suave">Feriados, folgas ou dias sem entrevista. Nesses dias nenhum horário é oferecido.</p>
        {podeEditar && (
          <div className="cartao mb-3 flex flex-col gap-2 p-4 sm:flex-row sm:items-end">
            <label className="text-sm"><span className="rotulo">Data</span><input type="date" className="campo" min={hojeBrasilia()} value={novoBloqueio.data} onChange={(e) => setNovoBloqueio((b) => ({ ...b, data: e.target.value }))} /></label>
            <Campo rotulo="Motivo (opcional)" className="flex-1" value={novoBloqueio.motivo} maxLength={120} onChange={(e) => setNovoBloqueio((b) => ({ ...b, motivo: e.target.value }))} />
            <Botao variante="secundario" carregando={ocupado} disabled={!novoBloqueio.data}
              onClick={() => void acao(() => api.post('/api/entrevistas/bloqueios', { unidadeId, data: novoBloqueio.data, motivo: novoBloqueio.motivo || undefined }), 'Dia bloqueado.', () => { setNovoBloqueio({ data: '', motivo: '' }); void bloq.recarregar(); })}>
              Bloquear dia
            </Botao>
          </div>
        )}
        {!bloq.dados?.length ? <p className="text-sm text-suave">Nenhum dia bloqueado.</p> : (
          <ul className="flex flex-wrap gap-2">
            {bloq.dados.map((b) => (
              <li key={b.id} className="inline-flex items-center gap-2 rounded-full border border-borda bg-superficie px-3 py-1.5 text-sm">
                <strong>{dataBr(b.data)}</strong>{b.motivo && <span className="text-suave">{b.motivo}</span>}
                {podeEditar && <button onClick={() => void acao(() => api.del(`/api/entrevistas/bloqueios/${b.id}`), 'Bloqueio removido.', () => void bloq.recarregar())} className="grid size-6 place-items-center rounded-full hover:bg-superficie-2" aria-label={`Remover bloqueio de ${dataBr(b.data)}`}><X className="size-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editando && <FormDisponibilidade unidadeId={unidadeId} disp={editando === 'novo' ? null : editando} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); void disp.recarregar(); }} />}
      <Confirmar aberto={Boolean(excluir)} titulo="Excluir período?" perigo rotulo="Excluir" carregando={ocupado}
        texto="Os horários deste período deixam de ser oferecidos. Entrevistas já marcadas continuam valendo."
        onCancelar={() => setExcluir(null)}
        onConfirmar={() => void acao(() => api.del(`/api/entrevistas/disponibilidades/${excluir!.id}`), 'Período excluído.', () => { setExcluir(null); void disp.recarregar(); })} />
    </div>
  );
}

function FormDisponibilidade({ unidadeId, disp, onFechar, onSalvo }: { unidadeId: string; disp: Disponibilidade | null; onFechar: () => void; onSalvo: () => void }) {
  const responsaveis = useDados<{ id: string; nome: string }[]>('/api/entrevistas/responsaveis');
  const [dataInicial, setDataInicial] = useState(disp?.dataInicial ?? hojeBrasilia());
  const [dataFinal, setDataFinal] = useState(disp?.dataFinal ?? somarDias(hojeBrasilia(), 30));
  const [dias, setDias] = useState<number[]>(disp?.diasSemana ?? [1, 2, 3, 4, 5]);
  const [horarios, setHorarios] = useState<string[]>(disp?.horarios ?? []);
  const [novoHorario, setNovoHorario] = useState('');
  const [duracao, setDuracao] = useState(String(disp?.duracaoMinutos ?? 30));
  const [vagas, setVagas] = useState(String(disp?.vagasPorHorario ?? 1));
  const [responsavelId, setResponsavelId] = useState(disp?.responsavel?.id ?? '');
  const [local, setLocal] = useState(disp?.local ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const addHorario = () => {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(novoHorario) && !horarios.includes(novoHorario)) setHorarios((h) => [...h, novoHorario].sort());
    setNovoHorario('');
  };
  const salvar = async () => {
    setErro('');
    setSalvando(true);
    try {
      const corpo = { unidadeId, dataInicial, dataFinal, diasSemana: dias, horarios, duracaoMinutos: Number(duracao), vagasPorHorario: Number(vagas), responsavelId: responsavelId || null, local: local || null };
      if (disp) await api.put(`/api/entrevistas/disponibilidades/${disp.id}`, corpo);
      else await api.post('/api/entrevistas/disponibilidades', corpo);
      onSalvo();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal aberto onFechar={onFechar} titulo={disp ? 'Editar período' : 'Novo período de entrevistas'} largura="max-w-2xl"
      rodape={<><Botao variante="secundario" onClick={onFechar}>Cancelar</Botao><Botao carregando={salvando} disabled={!dias.length || !horarios.length} onClick={() => void salvar()}>Salvar</Botao></>}>
      <div className="space-y-5">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm"><span className="rotulo">Data inicial</span><input type="date" className="campo" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} /></label>
          <label className="text-sm"><span className="rotulo">Data final</span><input type="date" className="campo" min={dataInicial} value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} /></label>
        </div>
        <fieldset>
          <legend className="rotulo">Dias da semana</legend>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((n, i) => (
              <button key={n} type="button" aria-pressed={dias.includes(i)} onClick={() => setDias((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()))}
                className={`min-h-11 min-w-14 rounded-xl border px-3 text-sm font-semibold ${dias.includes(i) ? 'border-grafite bg-grafite text-white dark:border-amarelo dark:bg-amarelo dark:text-grafite' : 'border-borda bg-superficie'}`}>{n}</button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="rotulo">Horários</legend>
          <div className="flex gap-2">
            <input type="time" className="campo w-40" value={novoHorario} onChange={(e) => setNovoHorario(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHorario())} aria-label="Novo horário" />
            <Botao variante="secundario" icone={<Plus className="size-4" />} onClick={addHorario} disabled={!novoHorario}>Adicionar</Botao>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {horarios.map((h) => (
              <span key={h} className="inline-flex items-center gap-1 rounded-lg bg-superficie-2 py-1 pl-2.5 pr-1 text-sm font-semibold">
                {h}<button type="button" onClick={() => setHorarios((x) => x.filter((y) => y !== h))} className="grid size-6 place-items-center rounded-full hover:bg-superficie" aria-label={`Tirar ${h}`}><X className="size-3.5" /></button>
              </span>
            ))}
            {!horarios.length && <span className="text-sm text-suave">Nenhum horário ainda.</span>}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Duração (min)" type="number" min={5} max={480} value={duracao} onChange={(e) => setDuracao(e.target.value)} />
          <Campo rotulo="Vagas por horário" type="number" min={1} max={50} value={vagas} onChange={(e) => setVagas(e.target.value)} />
          <Selecao rotulo="Responsável" value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            <option value="">A definir</option>
            {responsaveis.dados?.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </Selecao>
        </div>
        <Campo rotulo="Local ou instrução para o candidato (opcional)" value={local} onChange={(e) => setLocal(e.target.value)} maxLength={255} placeholder="Ex.: endereço da loja, procurar pelo gerente" />
      </div>
    </Modal>
  );
}
