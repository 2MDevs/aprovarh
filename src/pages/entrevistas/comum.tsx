import { CalendarX2, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Selo } from '../../components/ui';
import { query } from '../../lib/api';
import { useDados } from '../../lib/useDados';

export interface Horario { inicioEm: string; data: string; hora: string; vagas: number; ocupadas: number; livres: number; duracaoMinutos: number; local: string | null }

export const SITUACAO_ENTREVISTA: Record<string, { texto: string; tom: 'verde' | 'amarelo' | 'cinza' | 'vermelho' }> = {
  aguardando_confirmacao: { texto: 'Aguardando confirmação', tom: 'amarelo' },
  confirmada: { texto: 'Confirmada', tom: 'verde' },
  remarcacao_solicitada: { texto: 'Pediu outra data', tom: 'amarelo' },
  cancelada: { texto: 'Cancelada', tom: 'cinza' },
  remarcada: { texto: 'Remarcada', tom: 'cinza' },
  realizada: { texto: 'Realizada', tom: 'verde' },
  nao_compareceu: { texto: 'Não compareceu', tom: 'vermelho' },
};

export function SeloEntrevista({ situacao }: { situacao: string }) {
  const s = SITUACAO_ENTREVISTA[situacao] ?? { texto: situacao, tom: 'cinza' as const };
  return <Selo tom={s.tom}>{s.texto}</Selo>;
}

const FUSO = { timeZone: 'America/Sao_Paulo' } as const;
export const diaLongo = (data: string) => new Date(`${data}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' });
export const quando = (iso: string) => `${new Date(iso).toLocaleDateString('pt-BR', { ...FUSO, weekday: 'short', day: '2-digit', month: '2-digit' })} às ${new Date(iso).toLocaleTimeString('pt-BR', { ...FUSO, hour: '2-digit', minute: '2-digit' })}`;

/** Escolha de horário: só aparecem os horários da disponibilidade da unidade, com vaga. */
export function SeletorHorario({ unidadeId, valor, onChange, ignorarEntrevistaId }: { unidadeId: string; valor: string | null; onChange: (inicioEm: string) => void; ignorarEntrevistaId?: string }) {
  const { dados, carregando, erro } = useDados<Horario[]>(`/api/entrevistas/horarios${query({ unidadeId, ignorar: ignorarEntrevistaId })}`);
  const porDia = useMemo(() => {
    const m = new Map<string, Horario[]>();
    for (const h of dados ?? []) m.set(h.data, [...(m.get(h.data) ?? []), h]);
    return [...m.entries()];
  }, [dados]);
  const [dia, setDia] = useState<string | null>(null);
  const diaAtivo = dia ?? porDia[0]?.[0] ?? null;

  if (carregando) return <p className="flex items-center gap-2 py-6 text-sm text-suave"><Loader2 className="size-4 animate-spin" /> Buscando horários...</p>;
  if (erro) return <p className="text-sm text-vermelho">{erro.message}</p>;
  if (!porDia.length) {
    return (
      <div className="rounded-2xl border border-dashed border-borda p-6 text-center text-sm text-suave">
        <CalendarX2 className="mx-auto mb-2 size-8" />
        Esta unidade não tem horários livres nos próximos 60 dias. Cadastre a disponibilidade em Entrevistas › Disponibilidade.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Dias com horário livre">
        {porDia.map(([d, hs]) => (
          <button key={d} role="tab" aria-selected={d === diaAtivo} onClick={() => setDia(d)}
            className={`shrink-0 rounded-2xl border px-3 py-2 text-left text-sm ${d === diaAtivo ? 'border-grafite bg-grafite text-white dark:border-amarelo dark:bg-amarelo dark:text-grafite' : 'border-borda bg-superficie'}`}>
            <span className="block font-semibold capitalize">{new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
            <span className="text-xs opacity-75">{hs.filter((h) => h.livres > 0).length} horário(s)</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {(porDia.find(([d]) => d === diaAtivo)?.[1] ?? []).map((h) => (
          <button key={h.inicioEm} disabled={h.livres < 1} onClick={() => onChange(h.inicioEm)} aria-pressed={valor === h.inicioEm}
            className={`min-h-11 rounded-xl border text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40
              ${valor === h.inicioEm ? 'border-verde bg-verde text-white' : 'border-borda bg-superficie hover:border-amarelo-forte'}`}>
            {h.hora}
            <span className="block text-[11px] font-normal">{h.livres > 0 ? `${h.livres} vaga(s)` : 'lotado'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
