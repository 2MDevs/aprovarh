import { CARDS, CATEGORIAS, type Categoria } from '@shared/automacoes';
import { ChevronDown, Search } from 'lucide-react';
import { useState } from 'react';
import { normalizar } from '../../lib/formato';
import { TIPO_ARRASTE } from './Canvas';
import { ESTILO } from './estilo';

/** Biblioteca de cards: arraste para a área (ou clique para pôr no meio da tela). */
export function Biblioteca({ temGatilho, whatsappConfigurado, onAdicionar }: { temGatilho: boolean; whatsappConfigurado: boolean; onAdicionar: (tipo: string) => void }) {
  const [busca, setBusca] = useState('');
  const [fechadas, setFechadas] = useState<Set<Categoria>>(new Set());
  const termo = normalizar(busca);
  const visiveis = CARDS.filter((c) => !termo || normalizar(`${c.nome} ${c.descricao}`).includes(termo));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-borda p-3">
        <label className="relative block">
          <span className="sr-only">Buscar card</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-suave" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar card" className="campo !py-2 pl-9" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {(Object.keys(CATEGORIAS) as Categoria[]).map((cat) => {
          const itens = visiveis.filter((c) => c.categoria === cat);
          if (!itens.length) return null;
          const aberta = Boolean(termo) || !fechadas.has(cat);
          return (
            <section key={cat} className="mb-2">
              <button type="button" aria-expanded={aberta}
                onClick={() => setFechadas((f) => { const n = new Set(f); if (n.has(cat)) n.delete(cat); else n.add(cat); return n; })}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs font-bold uppercase tracking-wide text-suave hover:text-texto">
                <span className="flex items-center gap-2"><span className={`size-3 rounded ${ESTILO[cat].barra}`} aria-hidden />{CATEGORIAS[cat]} <span className="font-normal">({itens.length})</span></span>
                <ChevronDown className={`size-4 transition ${aberta ? '' : '-rotate-90'}`} />
              </button>
              {aberta && (
                <ul className="space-y-1">
                  {itens.map((c) => {
                    const bloqueado = cat === 'gatilho' && temGatilho;
                    const semWhats = c.usaWhatsapp && !whatsappConfigurado;
                    return (
                      <li key={c.tipo}>
                        <button type="button" disabled={bloqueado} draggable={!bloqueado}
                          onDragStart={(e) => { e.dataTransfer.setData(TIPO_ARRASTE, c.tipo); e.dataTransfer.effectAllowed = 'copy'; }}
                          onClick={() => onAdicionar(c.tipo)}
                          title={bloqueado ? 'O fluxo já tem um gatilho (só pode haver um).' : c.descricao}
                          className="group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2 py-2 text-left hover:border-borda hover:bg-superficie-2 disabled:cursor-not-allowed disabled:opacity-45">
                          <span className={`mt-1 h-7 w-1.5 shrink-0 rounded-full ${ESTILO[cat].barra}`} aria-hidden />
                          <span className="min-w-0">
                            <span className="block text-[13.5px] font-semibold leading-tight">{c.nome}</span>
                            <span className="line-clamp-2 text-[12px] text-suave">{semWhats ? 'Precisa do WhatsApp configurado.' : c.descricao}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {!visiveis.length && <p className="px-2 py-6 text-center text-sm text-suave">Nenhum card encontrado.</p>}
      </div>
      <p className="border-t border-borda px-3 py-2 text-[11px] text-suave">Arraste para a área ou clique para adicionar.</p>
    </div>
  );
}
