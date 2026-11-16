import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock, Hourglass, Inbox, MessageCircleWarning, ThumbsDown, ThumbsUp, UserPlus, Users, Workflow } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Cabecalho, Carregando, ErroCarregar, SemPermissao } from '../../components/ui';
import { useEventos } from '../../lib/eventos';
import { relativo } from '../../lib/formato';
import { useDados } from '../../lib/useDados';

interface Painel {
  dias: number; desde: string; ate: string; atualizadoEm: string;
  indicadores: {
    totalCandidatos: number; novasCandidaturas: number; aguardandoEntrevista: number; entrevistasAgendadas: number;
    preAprovados: number; aprovados: number; reprovados: number; aguardandoResposta: number;
    mensagensNaoLidas: number; conversasNaoLidas: number; automacoesComErro: number; execucoesComErro: number;
  };
  entrevistas: { aguardandoConfirmacao: number; confirmadas: number; pediramOutraData: number };
  proximasEntrevistas: { id: string; candidatoId: string; nome: string; unidade: string; inicioEm: string; situacao: string }[];
  serie: { dia: string; n: number }[];
  porUnidade: { id: string; nome: string; total: number; emAndamento: number }[];
  porStatus: { id: string; nome: string; cor: string; final: boolean; n: number }[];
}

const PERIODOS = [[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']] as const;
const SITUACAO: Record<string, string> = { aguardando_confirmacao: 'Aguardando confirmação', confirmada: 'Confirmada', remarcacao_solicitada: 'Pediu outra data' };
const num = (n: number) => n.toLocaleString('pt-BR');
const br = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
const quando = (v: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v));

/** Visão geral da gestora (seção 11): todos os números vêm do banco, nas unidades que a pessoa atende. */
export function VisaoGeral() {
  const { pode } = useSessao();
  const [dias, setDias] = useState(30);
  const [unidadeId, setUnidadeId] = useState('');
  const unidades = useDados<{ id: string; nome: string; ativa: boolean }[]>(pode('dashboard.ver') ? '/api/unidades' : null);
  const painel = useDados<Painel>(pode('dashboard.ver') ? `/api/painel?dias=${dias}${unidadeId ? `&unidadeId=${unidadeId}` : ''}` : null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEventos(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => void painel.recarregar(), 1500); // junta vários avisos seguidos
  }, pode('dashboard.ver'));

  if (!pode('dashboard.ver')) return <SemPermissao />;
  const d = painel.dados;
  const i = d?.indicadores;
  const periodo = dias === 1 ? 'hoje' : `nos últimos ${dias} dias`;

  return (
    <>
      <Cabecalho titulo="Visão geral" descricao="Como está o recrutamento agora. Os números vêm direto do sistema e se atualizam sozinhos." />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período das candidaturas">
          {PERIODOS.map(([v, rotulo]) => (
            <button key={v} onClick={() => setDias(v)} aria-pressed={dias === v}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold ${dias === v ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda bg-superficie text-suave hover:text-texto'}`}>{rotulo}</button>
          ))}
        </div>
        {(unidades.dados?.length ?? 0) > 1 && (
          <label className="sm:w-64">
            <span className="sr-only">Unidade</span>
            <select className="campo" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Todas as unidades</option>
              {unidades.dados!.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
        )}
      </div>

      {painel.carregando && !d ? <Carregando /> : painel.erro ? <ErroCarregar mensagem={painel.erro.message} onTentar={painel.recarregar} /> : d && i && (
        <div className="space-y-6">
          {/* Atenção primeiro: o que pede ação da equipe */}
          <section aria-label="Pede atenção" className="grid gap-4 sm:grid-cols-3">
            <Destaque icone={<MessageCircleWarning className="size-5" />} rotulo="Aguardando resposta" valor={i.aguardandoResposta} para="/conversas"
              detalhe="candidatos cuja última mensagem ainda não foi respondida" alerta={i.aguardandoResposta > 0} />
            <Destaque icone={<Inbox className="size-5" />} rotulo="Mensagens não lidas" valor={i.mensagensNaoLidas} para="/conversas"
              detalhe={i.conversasNaoLidas ? `em ${num(i.conversasNaoLidas)} conversa(s)` : 'nenhuma conversa com mensagem nova'} alerta={i.mensagensNaoLidas > 0} />
            <Destaque icone={<Workflow className="size-5" />} rotulo="Automações com erro" valor={i.automacoesComErro} para="/automacoes" critico
              detalhe={i.execucoesComErro ? `${num(i.execucoesComErro)} execução(ões) para reprocessar` : 'tudo rodando normalmente'} alerta={i.automacoesComErro > 0} />
          </section>

          <section aria-label="Indicadores" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Numero icone={<Users className="size-4" />} rotulo="Total de candidatos" valor={i.totalCandidatos} para="/candidatos" />
            <Numero icone={<UserPlus className="size-4" />} rotulo="Novas candidaturas" valor={i.novasCandidaturas} detalhe={periodo} para="/candidatos" />
            <Numero icone={<Hourglass className="size-4" />} rotulo="Aguardando entrevista" valor={i.aguardandoEntrevista} detalhe="no status" para="/candidatos" />
            <Numero icone={<CalendarDays className="size-4" />} rotulo="Entrevistas agendadas" valor={i.entrevistasAgendadas} detalhe="daqui para frente" para="/entrevistas" />
            <Numero icone={<CheckCircle2 className="size-4" />} rotulo="Pré-aprovados" valor={i.preAprovados} para="/candidatos" />
            <Numero icone={<ThumbsUp className="size-4" />} rotulo="Aprovados" valor={i.aprovados} para="/candidatos" />
            <Numero icone={<ThumbsDown className="size-4" />} rotulo="Reprovados" valor={i.reprovados} para="/candidatos" />
            <div className="cartao p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-suave"><CalendarClock className="size-4" /> Entrevistas</p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-suave">Confirmadas</dt><dd className="font-semibold tabular-nums">{num(d.entrevistas.confirmadas)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-suave">Aguardando confirmação</dt><dd className="font-semibold tabular-nums">{num(d.entrevistas.aguardandoConfirmacao)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-suave">Pediram outra data</dt><dd className="font-semibold tabular-nums">{num(d.entrevistas.pediramOutraData)}</dd></div>
              </dl>
            </div>
          </section>

          {dias > 1 && (
            <section className="cartao p-5" aria-labelledby="t-serie">
              <h2 id="t-serie" className="font-semibold">Novas candidaturas por dia</h2>
              <p className="text-[13px] text-suave">{br(d.desde)} a {br(d.ate)} · {num(i.novasCandidaturas)} no total</p>
              <BarrasPorDia serie={d.serie} />
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="cartao p-5" aria-labelledby="t-unidade">
              <h2 id="t-unidade" className="font-semibold">Candidatos por unidade</h2>
              <p className="mb-4 text-[13px] text-suave">Total de cada unidade e quantos ainda estão em andamento</p>
              <BarrasHorizontais itens={d.porUnidade.map((u) => ({ id: u.id, rotulo: u.nome, valor: u.total, extra: `${num(u.emAndamento)} em andamento` }))} vazio="Nenhuma unidade." />
            </section>
            <section className="cartao p-5" aria-labelledby="t-status">
              <h2 id="t-status" className="font-semibold">Candidatos por status</h2>
              <p className="mb-4 text-[13px] text-suave">Onde cada pessoa está no processo agora</p>
              <BarrasHorizontais itens={d.porStatus.map((s) => ({ id: s.id, rotulo: s.nome, valor: s.n, cor: s.cor, extra: s.final ? 'encerra o processo' : undefined }))} vazio="Nenhum status." />
            </section>
          </div>

          <section className="cartao p-5" aria-labelledby="t-proximas">
            <div className="flex items-center justify-between gap-2">
              <h2 id="t-proximas" className="font-semibold">Próximas entrevistas</h2>
              <Link to="/entrevistas" className="text-sm font-semibold underline-offset-2 hover:underline">Ver agenda</Link>
            </div>
            {!d.proximasEntrevistas.length ? <p className="mt-3 text-sm text-suave">Nenhuma entrevista marcada daqui para frente.</p> : (
              <ul className="mt-3 divide-y divide-borda">
                {d.proximasEntrevistas.map((e) => (
                  <li key={e.id}>
                    <Link to={`/conversas?c=${e.candidatoId}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5 hover:bg-superficie-2">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{e.nome}</span>
                        <span className="text-[13px] text-suave">{e.unidade} · <span className="capitalize">{quando(e.inicioEm)}</span></span>
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${e.situacao === 'confirmada' ? 'bg-verde/12 text-verde dark:text-emerald-300' : 'bg-amarelo/30 text-grafite dark:text-amarelo'}`}>
                        {e.situacao === 'confirmada' ? <CheckCircle2 className="size-3.5" /> : <Clock className="size-3.5" />}{SITUACAO[e.situacao] ?? e.situacao}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-[12px] text-suave">Atualizado {relativo(d.atualizadoEm)}. "Aguardando resposta" conta os candidatos em andamento cuja última mensagem é deles.</p>
        </div>
      )}
    </>
  );
}

function Destaque({ icone, rotulo, valor, detalhe, para, alerta, critico }: { icone: ReactNode; rotulo: string; valor: number; detalhe: string; para: string; alerta: boolean; critico?: boolean }) {
  const cor = !alerta ? '' : critico ? 'border-vermelho/50 bg-vermelho/5' : 'border-amarelo-forte bg-amarelo/15';
  return (
    <Link to={para} className={`cartao block p-5 transition hover:shadow-md ${cor}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className={`grid size-8 place-items-center rounded-xl ${alerta && critico ? 'bg-vermelho text-white' : 'bg-grafite text-amarelo'}`}>{icone}</span>
        {rotulo}
        {alerta && <AlertTriangle className={`ml-auto size-4 ${critico ? 'text-vermelho' : 'text-amarelo-forte'}`} aria-label="Pede atenção" />}
      </p>
      <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight">{num(valor)}</p>
      <p className="mt-1 text-[13px] text-suave">{detalhe}</p>
    </Link>
  );
}

function Numero({ icone, rotulo, valor, detalhe, para }: { icone: ReactNode; rotulo: string; valor: number; detalhe?: string; para: string }) {
  return (
    <Link to={para} className="cartao block p-4 transition hover:shadow-md">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-suave">{icone}{rotulo}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{num(valor)}</p>
      {detalhe && <p className="text-[12px] text-suave">{detalhe}</p>}
    </Link>
  );
}

/** Colunas por dia, com dica ao passar o mouse (ou o dedo) e tabela para leitores de tela. */
function BarrasPorDia({ serie }: { serie: { dia: string; n: number }[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...serie.map((s) => s.n));
  const topo = Math.max(1, Math.ceil(max / 5) * 5 > max * 1.6 ? max : Math.ceil(max / 5) * 5);
  const marcas = [0, Math.round(serie.length / 2), serie.length - 1].filter((x, j, a) => a.indexOf(x) === j);
  const f = foco !== null ? serie[foco] : null;
  return (
    <div className="mt-4">
      <div className="relative flex h-44 items-end gap-[2px] border-b border-borda pl-8" onPointerLeave={() => setFoco(null)}>
        <span className="absolute left-0 top-0 text-[11px] tabular-nums text-suave">{topo}</span>
        <span className="absolute bottom-0 left-0 text-[11px] text-suave">0</span>
        <span className="pointer-events-none absolute left-8 right-0 top-[6px] border-t border-dashed border-borda" aria-hidden />
        {serie.map((s, j) => (
          <div key={s.dia} className="relative flex h-full flex-1 items-end" onPointerEnter={() => setFoco(j)} onPointerDown={() => setFoco(j)} aria-hidden>
            <div className={`mx-auto w-full max-w-12 rounded-t-[4px] ${foco === j ? 'bg-vermelho' : 'bg-grafite dark:bg-amarelo'}`} style={{ height: s.n ? `${Math.max(3, (s.n / topo) * 100)}%` : 0 }} />
          </div>
        ))}
        {f && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-grafite px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-creme dark:text-grafite"
            style={{ left: `calc(2rem + (100% - 2rem) * ${(foco! + 0.5) / serie.length})` }}>
            <strong className="tabular-nums">{num(f.n)}</strong> em {br(f.dia)}
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 pl-8 text-[11px] text-suave" aria-hidden>
        {marcas.map((j) => (
          <span key={j} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `calc(2rem + (100% - 2rem) * ${(j + 0.5) / serie.length})` }}>{br(serie[j].dia)}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Novas candidaturas por dia</caption>
        <thead><tr><th>Dia</th><th>Candidaturas</th></tr></thead>
        <tbody>{serie.map((s) => <tr key={s.dia}><td>{br(s.dia)}</td><td>{s.n}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Barras deitadas com rótulo e valor escritos (a cor do status aparece só como ponto de identificação). */
function BarrasHorizontais({ itens, vazio }: { itens: { id: string; rotulo: string; valor: number; extra?: string; cor?: string }[]; vazio: string }) {
  if (!itens.length) return <p className="text-sm text-suave">{vazio}</p>;
  const max = Math.max(1, ...itens.map((x) => x.valor));
  return (
    <ul className="space-y-3">
      {itens.map((x) => (
        <li key={x.id}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              {x.cor && <span className="size-2.5 shrink-0 rounded-full ring-2 ring-superficie" style={{ background: x.cor }} aria-hidden />}
              <span className="truncate font-medium">{x.rotulo}</span>
            </span>
            <span className="shrink-0 tabular-nums"><strong>{num(x.valor)}</strong>{x.extra && <span className="text-[12px] text-suave"> · {x.extra}</span>}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-superficie-2" aria-hidden>
            <div className="h-2 rounded-full bg-grafite dark:bg-amarelo" style={{ width: x.valor ? `${Math.max(2, (x.valor / max) * 100)}%` : 0 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
