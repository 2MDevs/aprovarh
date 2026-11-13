const FUSO = 'America/Sao_Paulo';

export function dataHora(v?: string | Date | null): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(new Date(v));
}

export function data(v?: string | Date | null): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short' }).format(new Date(v));
}

export function relativo(v?: string | Date | null): string {
  if (!v) return 'nunca';
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `há ${Math.floor(s / 86400)} dia(s)`;
  return data(v);
}

export function bytes(n?: number | null): string {
  if (n === null || n === undefined) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${u[i]}`;
}

export function duracao(segundos: number): string {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

/** Comparação sem acentos e sem maiúsculas (busca). */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
