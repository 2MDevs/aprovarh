/** Datas no fuso de Brasília, calculadas pelo banco de fusos do sistema (IANA), não por um "-3" fixo. */
export const FUSO = 'America/Sao_Paulo';

/** Diferença do fuso para UTC, em minutos, num instante (ex.: -180). */
function deslocamentoMin(instante: number, fuso = FUSO): number {
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instante)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = nome.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** Ano, mês e dia de um instante no fuso de Brasília. */
export function diaEmBrasilia(instante = Date.now()): { ano: number; mes: number; dia: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante));
  const [ano, mes, dia] = p.split('-').map(Number);
  return { ano, mes, dia };
}

/** 23:59:59.999 do dia de hoje em Brasília, como instante UTC. */
export function fimDoDiaEmBrasilia(instante = Date.now()): Date {
  const { ano, mes, dia } = diaEmBrasilia(instante);
  const local = Date.UTC(ano, mes - 1, dia, 23, 59, 59, 999);
  // "local" foi montado como se fosse UTC; tira o deslocamento do fuso naquele horário.
  return new Date(local - deslocamentoMin(local - 3 * 3_600_000) * 60_000);
}

/** "2026-11-20" + "14:30" (horário de Brasília) → instante UTC. */
export function instanteEmBrasilia(data: string, hhmm: string): Date {
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  const local = Date.UTC(ano, mes - 1, dia, h, m, 0, 0);
  return new Date(local - deslocamentoMin(local - 3 * 3_600_000) * 60_000);
}

/** Instante → data, hora e dia da semana (0 = domingo) em Brasília. */
export function partesEmBrasilia(instante: Date | number): { data: string; hora: string; diaSemana: number } {
  const d = new Date(instante);
  const data = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const [ano, mes, dia] = data.split('-').map(Number);
  return { data, hora, diaSemana: new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay() };
}

/** Lista as datas (YYYY-MM-DD) de um intervalo, inclusive. */
export function datasEntre(inicio: string, fim: string): string[] {
  const out: string[] = [];
  const [a, b, c] = inicio.split('-').map(Number);
  const fimMs = Date.parse(`${fim}T00:00:00Z`);
  for (let t = Date.UTC(a, b - 1, c); t <= fimMs && out.length < 400; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** "2026-11-20" → "sexta-feira, 20/11". */
export function dataPorExtenso(instante: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: '2-digit', month: '2-digit' }).format(instante);
}
