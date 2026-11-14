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
