/** Agenda dos convites (decisão D47): funções puras, sem banco, para poder testar. */
const OFFSET_BRASILIA_MS = -3 * 3_600_000; // Brasília não tem horário de verão desde 2019

// ── Agenda dos convites ────────────────────────────────────────────────────
export function janela(texto: string | null): { inicio: number; fim: number } {
  const m = (texto ?? '').match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  const inicio = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
  const fim = m ? Number(m[3]) * 60 + Number(m[4]) : 19 * 60;
  return fim > inicio ? { inicio, fim } : { inicio: 9 * 60, fim: 19 * 60 };
}

/** Início do dia de Brasília (em UTC) que contém o instante. */
function inicioDoDia(d: Date): Date {
  const local = new Date(d.getTime() + OFFSET_BRASILIA_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - OFFSET_BRASILIA_MS);
}
const minutosDoDia = (d: Date) => Math.floor((d.getTime() - inicioDoDia(d).getTime()) / 60_000);



export interface RegraConvites { intervaloSeg: number; porDia: number; janela: { inicio: number; fim: number } }

/** Escolhe o horário (puro, para teste): `contar(dia)` diz quantos convites já estão marcados naquele dia de Brasília. */
export async function escolherHorario(agora: Date, ultimo: Date | null, regra: RegraConvites, contar: (inicioDia: Date) => Promise<number>, sorte = Math.random): Promise<Date> {
  const variacao = regra.intervaloSeg * (1 + sorte() * 0.5) * 1000;
  let slot = new Date(Math.max(agora.getTime(), ultimo ? ultimo.getTime() + variacao : 0));
  const proximoDia = (dia: Date) => new Date(dia.getTime() + 86_400_000 + regra.janela.inicio * 60_000 + sorte() * 120_000);
  for (let i = 0; i < 400; i++) {
    const dia = inicioDoDia(slot);
    const min = minutosDoDia(slot);
    if (min < regra.janela.inicio) { slot = new Date(dia.getTime() + regra.janela.inicio * 60_000 + sorte() * 120_000); continue; }
    if (min >= regra.janela.fim) { slot = proximoDia(dia); continue; }
    if ((await contar(dia)) >= regra.porDia) { slot = proximoDia(dia); continue; }
    return slot;
  }
  throw new Error('Não foi possível agendar o convite. Confira o horário e o limite por dia em Integração › WhatsApp.');
}

