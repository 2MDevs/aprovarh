import { CARD, type Fluxo, type Ligacao, type No, type Problema } from '@shared/automacoes';
import { AlertTriangle, LayoutGrid, Maximize, Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as PE, type ReactNode, type Ref } from 'react';
import { COR_LINHA, ESTILO } from './estilo';
import {
  ALTURA, LARGURA, caminho, criariaCiclo, enquadrar, grade, limitarZoom, limites, novoId, organizar, paraFluxo,
  paramsIniciais, pontoEntrada, pontoSaida, saidasDo, type Ponto, type Visao,
} from './geometria';

export type Selecao = { tipo: 'no'; id: string } | { tipo: 'ligacao'; id: string };

export interface CanvasApi {
  enquadrar(): void;
  centralizar(noId: string): void;
  adicionar(tipo: string): void;
}

export const TIPO_ARRASTE = 'application/x-aprovarh-card';

interface Props {
  fluxo: Fluxo;
  /** Sem onChange, a área é só de leitura (versões antigas, execuções). */
  onChange?: (f: Fluxo) => void;
  selecionado: Selecao | null;
  onSelecionar: (s: Selecao | null) => void;
  problemas?: Map<string, Problema[]>;
  /** Caminho percorrido no teste (os outros cards ficam apagados). */
  destaque?: Set<string> | null;
  /** Card onde a execução está parada. */
  atual?: string | null;
  descrever?: (no: No) => string;
  onAviso?: (texto: string) => void;
  ref?: Ref<CanvasApi>;
}

type Gesto =
  | { tipo: 'mover'; id: string; inicio: Ponto; origem: Ponto; moveu: boolean }
  | { tipo: 'pan'; inicio: Ponto; origem: Visao; moveu: boolean }
  | { tipo: 'ligar'; de: string; saida: string; ponto: Ponto };

export function Canvas({ fluxo, onChange, selecionado, onSelecionar, problemas, destaque, atual, descrever, onAviso, ref }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [visao, setVisao] = useState<Visao>({ x: 40, y: 40, zoom: 1 });
  const [gesto, setGesto] = useState<Gesto | null>(null);
  const [posTemp, setPosTemp] = useState<{ id: string; p: Ponto } | null>(null);
  const editavel = Boolean(onChange);

  const nos = useMemo(() => fluxo.nos.map((n) => (posTemp && n.id === posTemp.id ? { ...n, posicao: posTemp.p } : n)), [fluxo.nos, posTemp]);
  const porId = useMemo(() => new Map(nos.map((n) => [n.id, n])), [nos]);

  const tamanho = () => ({ largura: area.current?.clientWidth ?? 800, altura: area.current?.clientHeight ?? 600 });
  const pontoTela = (e: { clientX: number; clientY: number }): Ponto => {
    const r = area.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const capturar = (id: number) => {
    try { area.current?.setPointerCapture(id); } catch { /* ponteiro já soltou */ }
  };

  const fazerEnquadrar = useCallback(() => setVisao(enquadrar(fluxo, tamanho())), [fluxo]);

  // Enquadra na primeira vez que o fluxo aparece.
  const enquadrado = useRef(false);
  useLayoutEffect(() => {
    if (enquadrado.current || !area.current) return;
    enquadrado.current = true;
    if (!fluxo.nos.length) return;
    const t = tamanho();
    const v = enquadrar(fluxo, t);
    if (v.zoom >= 0.6) return setVisao(v);
    // Fluxo grande: em vez de mostrar tudo minúsculo, começa legível pelo gatilho (o minimapa mostra o resto).
    const g = fluxo.nos.find((n) => CARD[n.tipo]?.categoria === 'gatilho') ?? fluxo.nos[0];
    const zoom = 0.8;
    setVisao({ zoom, x: t.largura / 2 - (g.posicao.x + LARGURA / 2) * zoom, y: 72 - g.posicao.y * zoom });
  }, [fluxo]);

  const adicionarEm = useCallback((tipo: string, p: Ponto) => {
    if (!onChange || !CARD[tipo]) return;
    const no: No = { id: novoId(fluxo, tipo), tipo, params: paramsIniciais(tipo), posicao: { x: grade(p.x - LARGURA / 2), y: grade(p.y - ALTURA / 2) } };
    onChange({ ...fluxo, nos: [...fluxo.nos, no] });
    onSelecionar({ tipo: 'no', id: no.id });
  }, [fluxo, onChange, onSelecionar]);

  useImperativeHandle(ref, () => ({
    enquadrar: fazerEnquadrar,
    centralizar(id) {
      const n = fluxo.nos.find((x) => x.id === id);
      if (!n) return;
      const t = tamanho();
      setVisao((v) => ({ ...v, x: t.largura / 2 - (n.posicao.x + LARGURA / 2) * v.zoom, y: t.altura / 2 - (n.posicao.y + ALTURA / 2) * v.zoom }));
    },
    adicionar(tipo) {
      const t = tamanho();
      const centro = paraFluxo({ x: t.largura / 2, y: t.altura / 2 }, visao);
      // não empilha um card em cima do outro
      let p = centro;
      while (fluxo.nos.some((n) => Math.abs(n.posicao.x + LARGURA / 2 - p.x) < 40 && Math.abs(n.posicao.y + ALTURA / 2 - p.y) < 40)) p = { x: p.x + 32, y: p.y + 32 };
      adicionarEm(tipo, p);
    },
  }), [fazerEnquadrar, fluxo, visao, adicionarEm]);

  // ── Zoom ──
  const zoomEm = (fator: number, ponto?: Ponto) => {
    const t = tamanho();
    const c = ponto ?? { x: t.largura / 2, y: t.altura / 2 };
    setVisao((v) => {
      const zoom = limitarZoom(v.zoom * fator);
      const k = zoom / v.zoom;
      return { zoom, x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k };
    });
  };

  // Roda do mouse: arrasta a área; com Ctrl (ou pinça no trackpad), aproxima. Listener não passivo para impedir a rolagem da página.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomEm(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        setVisao((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', roda, { passive: false });
    return () => el.removeEventListener('wheel', roda);
  }, []);

  // ── Gestos ──
  const iniciarPan = (e: PE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    capturar(e.pointerId);
    setGesto({ tipo: 'pan', inicio: pontoTela(e), origem: visao, moveu: false });
  };

  const iniciarMover = (e: PE, no: No) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelecionar({ tipo: 'no', id: no.id });
    if (!editavel) return;
    capturar(e.pointerId);
    setGesto({ tipo: 'mover', id: no.id, inicio: paraFluxo(pontoTela(e), visao), origem: no.posicao, moveu: false });
  };

  const iniciarLigacao = (e: PE, no: No, saida: string) => {
    if (!editavel || e.button !== 0) return;
    e.stopPropagation();
    capturar(e.pointerId);
    setGesto({ tipo: 'ligar', de: no.id, saida, ponto: paraFluxo(pontoTela(e), visao) });
  };

  const mover = (e: PE) => {
    if (!gesto) return;
    const tela = pontoTela(e);
    if (gesto.tipo === 'pan') {
      const dx = tela.x - gesto.inicio.x;
      const dy = tela.y - gesto.inicio.y;
      setVisao({ ...gesto.origem, x: gesto.origem.x + dx, y: gesto.origem.y + dy });
      if (!gesto.moveu && Math.hypot(dx, dy) > 3) setGesto({ ...gesto, moveu: true });
    } else if (gesto.tipo === 'mover') {
      const p = paraFluxo(tela, visao);
      const dx = p.x - gesto.inicio.x;
      const dy = p.y - gesto.inicio.y;
      if (!gesto.moveu && Math.hypot(dx, dy) < 3) return;
      if (!gesto.moveu) setGesto({ ...gesto, moveu: true });
      setPosTemp({ id: gesto.id, p: { x: grade(gesto.origem.x + dx), y: grade(gesto.origem.y + dy) } });
    } else {
      setGesto({ ...gesto, ponto: paraFluxo(tela, visao) });
    }
  };

  const ligar = (de: string, saida: string, para: string) => {
    if (!onChange) return;
    const destino = porId.get(para);
    if (!destino) return;
    if (de === para) return onAviso?.('Um card não pode ligar nele mesmo.');
    if (CARD[destino.tipo]?.categoria === 'gatilho') return onAviso?.('Nada pode ligar para o gatilho: ele é sempre o começo.');
    const semEsta = { ...fluxo, ligacoes: fluxo.ligacoes.filter((l) => !(l.de === de && l.saida === saida)) };
    if (criariaCiclo(semEsta, de, para)) return onAviso?.('Essa ligação criaria uma volta. Para repetir, use o card "Repetir tentativa".');
    const nova: Ligacao = { id: `l_${de}_${saida}`, de, saida, para };
    onChange({ ...semEsta, ligacoes: [...semEsta.ligacoes, nova] }); // cada saída liga em um card só: a nova substitui a antiga
    onSelecionar({ tipo: 'ligacao', id: nova.id });
  };

  const soltar = (e: PE) => {
    if (!gesto) return;
    if (gesto.tipo === 'pan' && !gesto.moveu) onSelecionar(null);
    if (gesto.tipo === 'mover' && gesto.moveu && posTemp && onChange) {
      onChange({ ...fluxo, nos: fluxo.nos.map((n) => (n.id === posTemp.id ? { ...n, posicao: posTemp.p } : n)) });
    }
    if (gesto.tipo === 'ligar') {
      const alvo = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-no-id]');
      if (alvo?.dataset.noId) ligar(gesto.de, gesto.saida, alvo.dataset.noId);
    }
    setPosTemp(null);
    setGesto(null);
  };

  // Soltar um card arrastado da biblioteca.
  const aoSoltarCard = (e: DragEvent) => {
    const tipo = e.dataTransfer?.getData(TIPO_ARRASTE);
    if (!tipo) return;
    e.preventDefault();
    adicionarEm(tipo, paraFluxo(pontoTela(e), visao));
  };

  const temDestaque = Boolean(destaque?.size);
  const transform = `translate(${visao.x}px, ${visao.y}px) scale(${visao.zoom})`;

  return (
    <div className="relative h-full w-full overflow-hidden bg-fundo">
      <div
        ref={area}
        className={`absolute inset-0 touch-none select-none ${gesto?.tipo === 'pan' && gesto.moveu ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ backgroundImage: 'radial-gradient(circle, var(--color-borda) 1.2px, transparent 1.2px)', backgroundSize: `${24 * visao.zoom}px ${24 * visao.zoom}px`, backgroundPosition: `${visao.x}px ${visao.y}px` }}
        onPointerDown={iniciarPan} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}
        onDragOver={(e) => { if (editavel && e.dataTransfer.types.includes(TIPO_ARRASTE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={aoSoltarCard}
        role="application" aria-label="Área de construção do fluxo"
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform }}>
          {/* Ligações */}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden>
            <defs>
              {Object.entries(COR_LINHA).map(([cat, cor]) => (
                <marker key={cat} id={`seta-${cat}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={cor} />
                </marker>
              ))}
              <marker id="seta-sel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#1F7A4D" /></marker>
            </defs>
            {fluxo.ligacoes.map((l) => {
              const de = porId.get(l.de);
              const para = porId.get(l.para);
              if (!de || !para) return null;
              const cat = CARD[de.tipo]?.categoria ?? 'acao';
              const sel = selecionado?.tipo === 'ligacao' && selecionado.id === l.id;
              const apagada = temDestaque && !(destaque!.has(l.de) && destaque!.has(l.para));
              const d = caminho(pontoSaida(de, l.saida), pontoEntrada(para));
              return (
                <g key={l.id} className={apagada ? 'opacity-25' : ''}>
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16} className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => { e.stopPropagation(); onSelecionar({ tipo: 'ligacao', id: l.id }); }} />
                  <path d={d} fill="none" stroke={sel ? '#1F7A4D' : COR_LINHA[cat]} strokeWidth={sel ? 3.5 : 2.2} markerEnd={`url(#${sel ? 'seta-sel' : `seta-${cat}`})`} />
                </g>
              );
            })}
            {gesto?.tipo === 'ligar' && porId.get(gesto.de) && (
              <path d={caminho(pontoSaida(porId.get(gesto.de)!, gesto.saida), gesto.ponto)} fill="none" stroke="#1F7A4D" strokeWidth={2.5} strokeDasharray="6 5" />
            )}
          </svg>

          {/* Cards */}
          {nos.map((n) => (
            <CardNo key={n.id} no={n} sel={selecionado?.tipo === 'no' && selecionado.id === n.id} problemas={problemas?.get(n.id) ?? []}
              apagado={temDestaque && !destaque!.has(n.id)} noCaminho={temDestaque && destaque!.has(n.id)} atual={atual === n.id}
              resumo={descrever?.(n) ?? ''} editavel={editavel} ligando={gesto?.tipo === 'ligar'} zoom={visao.zoom}
              onPointerDown={(e) => iniciarMover(e, n)} onSaida={(e, s) => iniciarLigacao(e, n, s)} />
          ))}
        </div>
      </div>

      {!fluxo.nos.length && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-sm rounded-2xl border border-dashed border-borda bg-superficie/80 p-6">
            <p className="font-semibold">Comece por um gatilho</p>
            <p className="mt-1 text-sm text-suave">Arraste um card da biblioteca para cá (ou clique nele). Depois, puxe a bolinha de baixo de um card até o próximo para ligar.</p>
          </div>
        </div>
      )}

      {/* Controles */}
      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full border border-borda bg-superficie p-1 shadow-sm">
        <BotaoIcone rotulo="Afastar" onClick={() => zoomEm(1 / 1.2)}><Minus className="size-4" /></BotaoIcone>
        <span className="w-12 text-center text-xs font-semibold tabular-nums text-suave" aria-live="polite">{Math.round(visao.zoom * 100)}%</span>
        <BotaoIcone rotulo="Aproximar" onClick={() => zoomEm(1.2)}><Plus className="size-4" /></BotaoIcone>
        <BotaoIcone rotulo="Ver o fluxo inteiro" onClick={fazerEnquadrar}><Maximize className="size-4" /></BotaoIcone>
        {editavel && (
          <BotaoIcone rotulo="Organizar os cards" onClick={() => { const f = organizar(fluxo); onChange!(f); setVisao(enquadrar(f, tamanho())); }}>
            <LayoutGrid className="size-4" />
          </BotaoIcone>
        )}
      </div>

      <Minimapa fluxo={fluxo} visao={visao} tamanho={tamanho} onIr={(p) => { const t = tamanho(); setVisao((v) => ({ ...v, x: t.largura / 2 - p.x * v.zoom, y: t.altura / 2 - p.y * v.zoom })); }} />
    </div>
  );
}

function BotaoIcone({ rotulo, onClick, children }: { rotulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={rotulo} aria-label={rotulo} className="grid size-9 place-items-center rounded-full text-texto hover:bg-superficie-2">
      {children}
    </button>
  );
}

function CardNo({ no, sel, problemas, apagado, noCaminho, atual, resumo, editavel, ligando, zoom, onPointerDown, onSaida }: {
  no: No; sel: boolean; problemas: Problema[]; apagado: boolean; noCaminho: boolean; atual: boolean; resumo: string; editavel: boolean; ligando: boolean; zoom: number;
  onPointerDown: (e: PE) => void; onSaida: (e: PE, saida: string) => void;
}) {
  const def = CARD[no.tipo];
  const cat = def?.categoria ?? 'acao';
  const est = ESTILO[cat];
  const erros = problemas.filter((p) => !p.aviso);
  const avisos = problemas.filter((p) => p.aviso);
  const saidas = saidasDo(no);
  const ehGatilho = cat === 'gatilho';
  // Área de pegar a bolinha: cresce quando a área está afastada (fica sempre com uns 14 px na tela).
  const pega = Math.min(44, Math.max(20, 14 / zoom));
  return (
    <div
      data-no-id={no.id}
      onPointerDown={onPointerDown}
      role="button" tabIndex={-1} aria-label={`${est.rotulo}: ${no.nome || def?.nome || no.tipo}`} aria-pressed={sel}
      className={`absolute flex flex-col rounded-2xl border bg-superficie shadow-sm transition-[box-shadow,opacity]
        ${sel ? 'border-verde ring-4 ring-verde/25' : erros.length ? 'border-vermelho/70' : 'border-borda'}
        ${noCaminho ? 'ring-4 ring-verde/40' : ''} ${atual ? 'ring-4 ring-amarelo' : ''} ${apagado ? 'opacity-35' : ''}
        ${editavel ? 'cursor-move' : 'cursor-pointer'} ${ligando && !ehGatilho ? 'hover:border-verde hover:ring-4 hover:ring-verde/30' : ''}`}
      style={{ left: no.posicao.x, top: no.posicao.y, width: LARGURA, height: ALTURA }}
    >
      {/* Entrada */}
      {!ehGatilho && <span className="absolute -top-[7px] left-1/2 size-3.5 -translate-x-1/2 rounded-full border-2 border-superficie bg-suave" aria-hidden />}
      <div className={`flex h-6 shrink-0 items-center justify-between rounded-t-2xl px-3 text-[11px] font-bold uppercase tracking-wide ${est.faixa} ${est.texto}`}>
        <span>{est.rotulo}</span>
        {erros.length > 0 ? (
          <span className="grid min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-vermelho" title={erros.map((p) => p.mensagem).join('\n')}>{erros.length}</span>
        ) : avisos.length > 0 ? <AlertTriangle className="size-3.5" aria-label="Tem avisos" /> : null}
      </div>
      <div className="min-w-0 flex-1 px-3 pt-1.5">
        <p className="truncate text-[13.5px] font-semibold leading-tight">{no.nome || def?.nome || no.tipo}</p>
        <p className="truncate text-[12px] text-suave">{resumo || (no.nome ? def?.nome : def?.descricao)}</p>
      </div>
      {/* Saídas */}
      <div className="relative h-5 shrink-0">
        {saidas.map((s, i) => {
          const x = (LARGURA * (i + 1)) / (saidas.length + 1);
          return (
            <span key={s.id}>
              {s.rotulo && <span className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-bold uppercase leading-none text-suave" style={{ left: x, top: 0 }}>{s.rotulo}</span>}
              <span
                onPointerDown={(e) => onSaida(e, s.id)}
                title={editavel ? `Puxe para ligar${s.rotulo ? ` (${s.rotulo})` : ''}` : undefined}
                className={`group/saida absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ${editavel ? 'cursor-crosshair' : ''}`}
                style={{ left: x, top: 20, width: pega, height: pega }}
                aria-hidden
              >
                <span className={`block size-4 rounded-full border-2 border-superficie shadow transition ${editavel ? 'group-hover/saida:scale-125' : ''}`} style={{ background: COR_LINHA[cat] }} />
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Minimapa({ fluxo, visao, tamanho, onIr }: { fluxo: Fluxo; visao: Visao; tamanho: () => { largura: number; altura: number }; onIr: (p: Ponto) => void }) {
  if (fluxo.nos.length < 2) return null;
  const L = 180;
  const A = 120;
  const t = tamanho();
  const vis = { x: -visao.x / visao.zoom, y: -visao.y / visao.zoom, largura: t.largura / visao.zoom, altura: t.altura / visao.zoom };
  const b = limites(fluxo);
  const x0 = Math.min(b.x, vis.x) - 40;
  const y0 = Math.min(b.y, vis.y) - 40;
  const x1 = Math.max(b.x + b.largura, vis.x + vis.largura) + 40;
  const y1 = Math.max(b.y + b.altura, vis.y + vis.altura) + 40;
  const k = Math.min(L / (x1 - x0), A / (y1 - y0));
  return (
    <svg width={L} height={A} className="absolute bottom-3 right-3 hidden cursor-pointer rounded-xl border border-borda bg-superficie/90 shadow-sm sm:block" aria-label="Minimapa"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onIr({ x: (e.clientX - r.left) / k + x0, y: (e.clientY - r.top) / k + y0 });
      }}>
      {fluxo.nos.map((n) => {
        const cat = CARD[n.tipo]?.categoria ?? 'acao';
        return <rect key={n.id} x={(n.posicao.x - x0) * k} y={(n.posicao.y - y0) * k} width={LARGURA * k} height={ALTURA * k} rx={2} fill={COR_LINHA[cat]} opacity={0.85} />;
      })}
      <rect x={(vis.x - x0) * k} y={(vis.y - y0) * k} width={vis.largura * k} height={vis.altura * k} fill="none" stroke="#1F7A4D" strokeWidth={1.5} rx={3} />
    </svg>
  );
}
