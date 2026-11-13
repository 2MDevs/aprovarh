import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { query } from '../../lib/api';
import { useDados } from '../../lib/useDados';
import type { StatusItem, Tag } from './tipos';

export interface ValoresFiltro { busca: string; unidadeId: string; statusId: string; tagId: string; de: string; ate: string; naoLidas: boolean }
export const FILTRO_VAZIO: ValoresFiltro = { busca: '', unidadeId: '', statusId: '', tagId: '', de: '', ate: '', naoLidas: false };

/** Monta a query da API (período em dias, no fuso de Brasília). */
export function queryFiltros(f: ValoresFiltro, extra: Record<string, string | number> = {}) {
  return query({
    busca: f.busca.trim() || undefined, unidadeId: f.unidadeId, statusId: f.statusId, tagId: f.tagId,
    de: f.de ? `${f.de}T00:00:00-03:00` : undefined, ate: f.ate ? `${f.ate}T23:59:59.999-03:00` : undefined,
    naoLidas: f.naoLidas ? '1' : undefined, ...extra,
  });
}

export function useOpcoesFiltro() {
  const unidades = useDados<{ id: string; nome: string }[]>('/api/unidades');
  const status = useDados<StatusItem[]>('/api/central/config/status');
  const tags = useDados<Tag[]>('/api/central/config/tags');
  return { unidades: unidades.dados ?? [], status: status.dados ?? [], tags: tags.dados ?? [], recarregar: () => { void status.recarregar(); void tags.recarregar(); } };
}

/** Barra de busca + filtros. `compacto` (lista de conversas): os filtros abrem num painel. */
export function Filtros({ valor, onChange, compacto }: { valor: ValoresFiltro; onChange: (v: ValoresFiltro) => void; compacto?: boolean }) {
  const op = useOpcoesFiltro();
  const [busca, setBusca] = useState(valor.busca);
  const [aberto, setAberto] = useState(!compacto);
  const ativos = [valor.unidadeId, valor.statusId, valor.tagId, valor.de, valor.ate, valor.naoLidas && '1'].filter(Boolean).length;

  // Busca aplica sozinha depois de uma pausa na digitação.
  useEffect(() => {
    const t = setTimeout(() => busca !== valor.busca && onChange({ ...valor, busca }), 350);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (campo: keyof ValoresFiltro, v: string | boolean) => onChange({ ...valor, [campo]: v });
  const sel = 'campo !py-2 text-sm';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Buscar candidato</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, código, CPF ou telefone" className="campo !py-2 pl-10" />
        </label>
        {compacto && (
          <button onClick={() => setAberto((v) => !v)} aria-expanded={aberto} aria-label="Filtros"
            className={`relative grid size-11 shrink-0 place-items-center rounded-xl border ${aberto || ativos ? 'border-grafite bg-grafite text-white dark:border-amarelo dark:bg-amarelo dark:text-grafite' : 'border-borda bg-superficie'}`}>
            <SlidersHorizontal className="size-4" />
            {ativos > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-vermelho text-[10px] font-bold text-white">{ativos}</span>}
          </button>
        )}
      </div>
      {aberto && (
        <div className={`grid gap-2 ${compacto ? 'grid-cols-2' : 'sm:grid-cols-3 lg:grid-cols-6'}`}>
          <select className={sel} value={valor.unidadeId} onChange={(e) => mudar('unidadeId', e.target.value)} aria-label="Unidade">
            <option value="">Todas as unidades</option>
            {op.unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
          <select className={sel} value={valor.statusId} onChange={(e) => mudar('statusId', e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            {op.status.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select className={sel} value={valor.tagId} onChange={(e) => mudar('tagId', e.target.value)} aria-label="Tag">
            <option value="">Todas as tags</option>
            {op.tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          <label className="text-xs text-suave">Candidatura de<input type="date" className={sel} value={valor.de} onChange={(e) => mudar('de', e.target.value)} /></label>
          <label className="text-xs text-suave">até<input type="date" className={sel} value={valor.ate} onChange={(e) => mudar('ate', e.target.value)} /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" className="size-5 accent-[#1D1D1B] dark:accent-[#F6D35C]" checked={valor.naoLidas} onChange={(e) => mudar('naoLidas', e.target.checked)} />
            Só não lidas
          </label>
          {ativos > 0 && (
            <button onClick={() => onChange({ ...FILTRO_VAZIO, busca: valor.busca })} className="col-span-full inline-flex min-h-9 items-center gap-1 justify-self-start text-sm font-semibold text-suave hover:text-texto">
              <X className="size-4" /> Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
