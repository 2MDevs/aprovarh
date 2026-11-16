import { CARD, LARGURA, ALTURA, organizar, type Fluxo, type No } from '@shared/automacoes';

export { LARGURA, ALTURA, organizar };

export interface Ponto { x: number; y: number }
export interface Visao { x: number; y: number; zoom: number }

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 1.6;
export const limitarZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function saidasDo(no: No) {
  return CARD[no.tipo]?.saidas ?? [];
}

/** Ponto de entrada (topo, no meio). */
export function pontoEntrada(no: No): Ponto {
  return { x: no.posicao.x + LARGURA / 2, y: no.posicao.y };
}

/** Pontos das saídas, distribuídos na base do card. */
export function pontoSaida(no: No, saida: string): Ponto {
  const s = saidasDo(no);
  const i = Math.max(0, s.findIndex((x) => x.id === saida));
  return { x: no.posicao.x + (LARGURA * (i + 1)) / (s.length + 1), y: no.posicao.y + ALTURA };
}

/** Curva da ligação (sai para baixo, entra por cima). Se o destino está acima, contorna pelo lado. */
export function caminho(a: Ponto, b: Ponto): string {
  const dy = Math.max(40, Math.abs(b.y - a.y) / 2);
  if (b.y >= a.y + 20) return `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`;
  const lado = Math.max(a.x, b.x) + LARGURA / 2 + 40;
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + 80}, ${lado} ${a.y + 80}, ${lado} ${(a.y + b.y) / 2} S ${b.x} ${b.y - 80}, ${b.x} ${b.y}`;
}

/** Retângulo que contém todos os cards. */
export function limites(f: Fluxo) {
  if (!f.nos.length) return { x: 0, y: 0, largura: LARGURA, altura: ALTURA };
  const xs = f.nos.map((n) => n.posicao.x);
  const ys = f.nos.map((n) => n.posicao.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, largura: Math.max(...xs) + LARGURA - x, altura: Math.max(...ys) + ALTURA - y };
}

/** Visão que enquadra o fluxo inteiro na área. */
export function enquadrar(f: Fluxo, area: { largura: number; altura: number }, margem = 48): Visao {
  const l = limites(f);
  const zoom = limitarZoom(Math.min((area.largura - margem * 2) / l.largura, (area.altura - margem * 2) / l.altura, 1));
  return { zoom, x: (area.largura - l.largura * zoom) / 2 - l.x * zoom, y: margem - l.y * zoom };
}

/** Tela → coordenadas do fluxo. */
export function paraFluxo(p: Ponto, v: Visao): Ponto {
  return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
}

/** Encaixa numa grade de 8 px. */
export const grade = (n: number) => Math.round(n / 8) * 8;

/** A ligação de→para criaria um ciclo? */
export function criariaCiclo(f: Fluxo, de: string, para: string): boolean {
  const pilha = [para];
  const vistos = new Set<string>();
  while (pilha.length) {
    const id = pilha.pop()!;
    if (id === de) return true;
    if (vistos.has(id)) continue;
    vistos.add(id);
    for (const l of f.ligacoes) if (l.de === id) pilha.push(l.para);
  }
  return false;
}

/** Identificador curto para um card novo. */
export function novoId(f: Fluxo, tipo: string): string {
  const base = tipo.split('.')[1]?.slice(0, 24) ?? 'card';
  let i = 1;
  while (f.nos.some((n) => n.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/** Parâmetros iniciais de um card (os padrões do catálogo). */
export function paramsIniciais(tipo: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of CARD[tipo]?.parametros ?? []) if (p.padrao !== undefined) out[p.chave] = Array.isArray(p.padrao) ? [...p.padrao] : p.padrao;
  return out;
}
