import { CARD, VARIAVEIS, param, type Fluxo, type No, type Parametro, type Problema } from '@shared/automacoes';
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Trash2, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Botao, Interruptor } from '../../components/ui';
import type { Selecao } from './Canvas';
import { ESTILO } from './estilo';
import type { Opcoes } from './tipos';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const nomeDoNo = (n: No) => n.nome || CARD[n.tipo]?.nome || n.tipo;

/** Linha curta mostrada no card da área (o que ele está configurado para fazer). */
export function descreverNo(no: No, o: Opcoes | null): string {
  const p = (k: string) => param(no, k);
  const nome = (lista: { id: string; nome: string }[] | undefined, id: unknown) => lista?.find((x) => x.id === id)?.nome;
  const varios = (lista: { id: string; nome: string }[] | undefined, ids: unknown) => (Array.isArray(ids) ? ids.map((i) => nome(lista, i)).filter(Boolean).join(', ') : '');
  switch (no.tipo) {
    case 'gatilho.data_entrevista': return `${Number(p('diasAntes')) ? `${p('diasAntes')} dia(s) antes` : 'No dia'}, às ${p('hora')}`;
    case 'gatilho.data_programada': return p('data') ? `${String(p('data')).split('-').reverse().join('/')} às ${p('hora') ?? '--:--'}` : '';
    case 'gatilho.horario_programado': return `${(p('dias') as number[] | undefined)?.map((d) => DIAS[d]).join(', ') ?? ''} às ${p('hora') ?? '--:--'}`;
    case 'gatilho.status_alterado': return p('status') ? `Para "${nome(o?.status, p('status'))}"` : 'Qualquer status';
    case 'gatilho.tag_adicionada': case 'condicao.tag': case 'acao.adicionar_tag': case 'acao.remover_tag': return nome(o?.tags, p('tag')) ?? '';
    case 'acao.alterar_status': return nome(o?.status, p('status')) ? `Para "${nome(o?.status, p('status'))}"` : '';
    case 'condicao.status': return varios(o?.status, p('status'));
    case 'condicao.unidade': return varios(o?.unidades, p('unidades'));
    case 'acao.whatsapp_mensagem': case 'acao.chat_mensagem': return String(p('texto') ?? '');
    case 'acao.notificar_gestora': return String(p('titulo') ?? '');
    case 'acao.atualizar_entrevista': return CARD[no.tipo].parametros[0].opcoes?.find((x) => x.valor === p('acao'))?.rotulo ?? '';
    case 'tempo.aguardar_periodo': return `${p('quantidade')} ${p('unidade')}`;
    case 'tempo.aguardar_resposta': return `Até ${p('prazoHoras')} h`;
    case 'tempo.aguardar_horario': return `Até ${p('hora') ?? '--:--'}`;
    case 'tempo.repetir': return `Até ${p('limite')} vez(es)`;
    case 'tempo.expirar_autorizacao': return `Depois de ${p('horas')} h`;
    default: return '';
  }
}

/** Cards antes deste (para o "Repetir tentativa" escolher para onde voltar). */
function anteriores(f: Fluxo, id: string): No[] {
  const out = new Set<string>();
  const pilha = [id];
  while (pilha.length) {
    const atual = pilha.pop()!;
    for (const l of f.ligacoes) if (l.para === atual && !out.has(l.de)) { out.add(l.de); pilha.push(l.de); }
  }
  return f.nos.filter((n) => out.has(n.id) && CARD[n.tipo]?.categoria !== 'gatilho');
}

interface Props {
  fluxo: Fluxo;
  selecao: Selecao;
  opcoes: Opcoes | null;
  problemas: Problema[];
  somenteLeitura: boolean;
  onChange: (f: Fluxo) => void;
  onFechar: () => void;
  onExcluir: () => void;
  onDuplicar: () => void;
}

export function PainelCard({ fluxo, selecao, opcoes, problemas, somenteLeitura, onChange, onFechar, onExcluir, onDuplicar }: Props) {
  if (selecao.tipo === 'ligacao') {
    const l = fluxo.ligacoes.find((x) => x.id === selecao.id);
    if (!l) return null;
    const de = fluxo.nos.find((n) => n.id === l.de);
    const para = fluxo.nos.find((n) => n.id === l.para);
    const saida = de ? CARD[de.tipo]?.saidas.find((s) => s.id === l.saida) : null;
    return (
      <div className="p-4">
        <Topo titulo="Ligação" onFechar={onFechar} />
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <strong>{de ? nomeDoNo(de) : '?'}</strong>{saida?.rotulo && <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs font-bold">{saida.rotulo}</span>}
          <ArrowRight className="size-4 text-suave" /><strong>{para ? nomeDoNo(para) : '?'}</strong>
        </p>
        {!somenteLeitura && <Botao variante="secundario" className="mt-4 w-full" icone={<Trash2 className="size-4" />} onClick={onExcluir}>Excluir ligação</Botao>}
      </div>
    );
  }

  const no = fluxo.nos.find((n) => n.id === selecao.id);
  if (!no) return null;
  const def = CARD[no.tipo];
  if (!def) return <div className="p-4"><Topo titulo="Card desconhecido" onFechar={onFechar} /><p className="mt-2 text-sm">{no.tipo}</p></div>;
  const est = ESTILO[def.categoria];
  const atualizar = (mudanca: Partial<No>) => onChange({ ...fluxo, nos: fluxo.nos.map((n) => (n.id === no.id ? { ...n, ...mudanca } : n)) });
  const setParam = (chave: string, v: unknown) => atualizar({ params: { ...no.params, [chave]: v } });
  const erros = problemas.filter((p) => !p.aviso);
  const avisos = problemas.filter((p) => p.aviso);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-borda p-4">
        <Topo titulo={def.nome} onFechar={onFechar} selo={<span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${est.selo}`}>{est.rotulo}</span>} />
        <p className="mt-2 text-[13px] text-suave">{def.descricao}</p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Situação da configuração */}
        {erros.length > 0 ? (
          <ul className="space-y-1 rounded-xl border border-vermelho/40 bg-vermelho/5 p-3 text-[13px] text-vermelho dark:text-red-300" role="alert">
            {erros.map((p, i) => <li key={i}>• {p.mensagem.replace(/^"[^"]+":\s*/, '')}</li>)}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-verde dark:text-emerald-300"><CheckCircle2 className="size-4" /> Card configurado</p>
        )}
        {avisos.map((p, i) => <p key={i} className="flex gap-2 rounded-xl bg-amarelo/20 p-3 text-[13px]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{p.mensagem.replace(/^"[^"]+":\s*/, '')}</p>)}

        <fieldset disabled={somenteLeitura} className="space-y-4">
          <CampoTexto rotulo="Nome no fluxo (opcional)" valor={no.nome ?? ''} placeholder={def.nome} max={80} onChange={(v) => atualizar({ nome: v || undefined })} />
          {def.parametros.map((p) => (
            <CampoParametro key={p.chave} p={p} valor={no.params[p.chave] ?? p.padrao} opcoes={opcoes} fluxo={fluxo} no={no} onChange={(v) => setParam(p.chave, v)} />
          ))}
        </fieldset>

        {/* Entradas e saídas */}
        <div className="rounded-xl bg-superficie-2 p-3 text-[13px]">
          <p className="font-semibold">Entradas e saídas</p>
          <p className="mt-1 text-suave">Entrada: {def.categoria === 'gatilho' ? 'nenhuma (é o começo do fluxo)' : `${fluxo.ligacoes.filter((l) => l.para === no.id).length} ligação(ões)`}</p>
          <ul className="mt-1 space-y-0.5">
            {def.saidas.map((s) => {
              const l = fluxo.ligacoes.find((x) => x.de === no.id && x.saida === s.id);
              const alvo = l && fluxo.nos.find((n) => n.id === l.para);
              return <li key={s.id} className="text-suave">Saída {s.rotulo ? <strong className="text-texto">{s.rotulo}</strong> : ''} → {alvo ? <span className="text-texto">{nomeDoNo(alvo)}</span> : 'termina o fluxo'}</li>;
            })}
          </ul>
        </div>
      </div>
      {!somenteLeitura && (
        <div className="flex gap-2 border-t border-borda p-3">
          <Botao variante="secundario" className="flex-1" icone={<Copy className="size-4" />} onClick={onDuplicar} disabled={def.categoria === 'gatilho'}>Duplicar</Botao>
          <Botao variante="secundario" className="flex-1" icone={<Trash2 className="size-4" />} onClick={onExcluir}>Excluir</Botao>
        </div>
      )}
    </div>
  );
}

function Topo({ titulo, selo, onFechar }: { titulo: string; selo?: ReactNode; onFechar: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        {selo}
        <h2 className="mt-1 text-lg font-bold leading-tight">{titulo}</h2>
      </div>
      <button type="button" onClick={onFechar} className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-superficie-2" aria-label="Fechar configurações"><X className="size-4" /></button>
    </div>
  );
}

function CampoTexto({ rotulo, valor, onChange, placeholder, max, longo, ajuda }: { rotulo: string; valor: string; onChange: (v: string) => void; placeholder?: string; max?: number; longo?: boolean; ajuda?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="rotulo">{rotulo}</label>
      {longo
        ? <textarea id={id} className="campo min-h-28" value={valor} maxLength={max ?? 1000} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className="campo" value={valor} maxLength={max ?? 1000} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      {ajuda && <div className="mt-1.5 text-[12px] text-suave">{ajuda}</div>}
    </div>
  );
}

function Marcar({ rotulo, itens, valor, onChange }: { rotulo: string; itens: { id: string; nome: string }[]; valor: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="rotulo">{rotulo}</legend>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-borda p-2">
        {itens.map((i) => (
          <label key={i.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-superficie-2">
            <input type="checkbox" className="size-4 accent-[#1D1D1B]" checked={valor.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...valor, i.id] : valor.filter((x) => x !== i.id))} />
            {i.nome}
          </label>
        ))}
        {!itens.length && <p className="px-2 py-1 text-sm text-suave">Nada cadastrado.</p>}
      </div>
    </fieldset>
  );
}

function CampoParametro({ p, valor, opcoes, fluxo, no, onChange }: { p: Parametro; valor: unknown; opcoes: Opcoes | null; fluxo: Fluxo; no: No; onChange: (v: unknown) => void }) {
  const id = useId();
  const rotulo = `${p.rotulo}${p.obrigatorio ? ' *' : ''}`;
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const selecao = (itens: { valor: string; rotulo: string }[], vazio?: string) => (
    <div>
      <label htmlFor={id} className="rotulo">{rotulo}</label>
      <select id={id} className="campo" value={String(valor ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {itens.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {p.ajuda && <p className="mt-1.5 text-[12px] text-suave">{p.ajuda}</p>}
    </div>
  );

  switch (p.tipo) {
    case 'texto':
      return <CampoTexto rotulo={rotulo} valor={String(valor ?? '')} max={p.max} ajuda={p.ajuda} onChange={(v) => onChange(v || undefined)} />;
    case 'textoLongo':
      return (
        <CampoTexto rotulo={rotulo} valor={String(valor ?? '')} max={p.max} longo onChange={(v) => onChange(v || undefined)}
          ajuda={p.variaveis && (
            <span className="flex flex-wrap gap-1">
              {Object.entries(VARIAVEIS).map(([k, v]) => (
                <button key={k} type="button" title={v.rotulo} onClick={() => onChange(`${String(valor ?? '')}{${k}}`)}
                  className="rounded-full border border-borda bg-superficie px-2 py-0.5 font-mono text-[11px] hover:bg-superficie-2">{`{${k}}`}</button>
              ))}
            </span>
          )} />
      );
    case 'numero':
      return (
        <div>
          <label htmlFor={id} className="rotulo">{rotulo}</label>
          <input id={id} type="number" className="campo" min={p.min} max={p.max} step={1} value={valor === undefined || valor === null ? '' : String(valor)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
          {p.ajuda && <p className="mt-1.5 text-[12px] text-suave">{p.ajuda}</p>}
        </div>
      );
    case 'hora': case 'data':
      return (
        <div>
          <label htmlFor={id} className="rotulo">{rotulo}</label>
          <input id={id} type={p.tipo === 'hora' ? 'time' : 'date'} className="campo" value={String(valor ?? '')} onChange={(e) => onChange(e.target.value || undefined)} />
        </div>
      );
    case 'booleano':
      return <Interruptor ligado={Boolean(valor)} onChange={onChange} rotulo={p.rotulo} descricao={p.ajuda} />;
    case 'selecao':
      return selecao(p.opcoes ?? [], p.obrigatorio && p.padrao === undefined ? 'Escolha...' : undefined);
    case 'status':
      return selecao((opcoes?.status ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })), p.obrigatorio ? 'Escolha o status...' : 'Qualquer um');
    case 'tag':
      return selecao((opcoes?.tags ?? []).map((s) => ({ valor: s.id, rotulo: s.nome })), p.obrigatorio ? 'Escolha a tag...' : 'Nenhuma');
    case 'statusVarios':
      return <Marcar rotulo={rotulo} itens={opcoes?.status ?? []} valor={lista(valor)} onChange={onChange} />;
    case 'unidades':
      return <Marcar rotulo={rotulo} itens={opcoes?.unidades ?? []} valor={lista(valor)} onChange={onChange} />;
    case 'diasSemana': {
      const v = (Array.isArray(valor) ? valor : []).map(Number);
      return (
        <fieldset>
          <legend className="rotulo">{rotulo}</legend>
          <div className="flex flex-wrap gap-1">
            {DIAS.map((d, i) => (
              <button key={d} type="button" aria-pressed={v.includes(i)} onClick={() => onChange(v.includes(i) ? v.filter((x) => x !== i) : [...v, i].sort())}
                className={`min-h-9 rounded-full px-3 text-sm font-semibold ${v.includes(i) ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'border border-borda text-suave'}`}>{d}</button>
            ))}
          </div>
        </fieldset>
      );
    }
    case 'no':
      return selecao(anteriores(fluxo, no.id).map((n) => ({ valor: n.id, rotulo: nomeDoNo(n) })), 'Escolha o card...');
  }
  return null;
}
