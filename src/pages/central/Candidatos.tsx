import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Botao, Cabecalho, Carregando, ErroCarregar, SemPermissao, Vazio } from '../../components/ui';
import { useEventos } from '../../lib/eventos';
import { dataHora } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { Foto, Pilula } from './comum';
import { Filtros, FILTRO_VAZIO, queryFiltros, type ValoresFiltro } from './Filtros';
import type { PaginaCandidatos } from './tipos';

/** Candidatos em tabela, para quem prefere trabalhar em lista. Clicar abre a conversa. */
export function Candidatos() {
  const { pode } = useSessao();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<ValoresFiltro>(FILTRO_VAZIO);
  const [pagina, setPagina] = useState(1);
  const lista = useDados<PaginaCandidatos>(pode('candidatos.ver') ? `/api/central/candidatos${queryFiltros(filtro, { pagina, porPagina: 30 })}` : null);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEventos(() => {
    clearTimeout(t.current);
    t.current = setTimeout(() => void lista.recarregar(), 500);
  }, pode('candidatos.ver'));

  if (!pode('candidatos.ver')) return <SemPermissao />;
  const total = lista.dados ? Math.max(1, Math.ceil(lista.dados.total / lista.dados.porPagina)) : 1;

  return (
    <>
      <Cabecalho titulo="Candidatos" descricao="Todos os candidatos das unidades que você atende." />
      <div className="cartao mb-4 p-4"><Filtros valor={filtro} onChange={(v) => { setFiltro(v); setPagina(1); }} /></div>
      {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /> : !lista.dados?.candidatos.length ? (
        <Vazio titulo="Nenhum candidato encontrado." />
      ) : (
        <>
          <div className="cartao overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-grafite text-xs uppercase tracking-wide text-creme">
                <tr>
                  <th className="px-4 py-3 font-semibold">Candidato</th><th className="px-4 py-3 font-semibold">Unidade</th><th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Tags</th><th className="px-4 py-3 font-semibold">Candidatura</th><th className="px-4 py-3 font-semibold">Não lidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {lista.dados.candidatos.map((c) => (
                  <tr key={c.id} tabIndex={0} className="cursor-pointer hover:bg-superficie-2" onClick={() => navegar(`/conversas?c=${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && navegar(`/conversas?c=${c.id}`)}>
                    <td className="px-4 py-3"><span className="flex items-center gap-3"><Foto candidatoId={c.id} fotoId={c.fotoId} nome={c.nome} tamanho={36} /><span><span className="block font-semibold">{c.nome}</span><span className="text-xs text-suave">{c.codigo}</span></span></span></td>
                    <td className="px-4 py-3">{c.unidade.nome}</td>
                    <td className="px-4 py-3"><Pilula cor={c.status.cor}>{c.status.nome}</Pilula></td>
                    <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{c.tags.map((tg) => <Pilula key={tg.id} cor={tg.cor} pequena>{tg.nome}</Pilula>)}</span></td>
                    <td className="whitespace-nowrap px-4 py-3 text-suave">{dataHora(c.candidaturaEm)}</td>
                    <td className="px-4 py-3">{c.naoLidas > 0 ? <span className="rounded-full bg-verde px-2 py-0.5 text-xs font-bold text-white">{c.naoLidas}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-suave">
            <span>{lista.dados.total.toLocaleString('pt-BR')} candidato(s)</span>
            <span className="flex items-center gap-2">
              <Botao variante="secundario" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} icone={<ChevronLeft className="size-4" />} />
              Página {pagina} de {total}
              <Botao variante="secundario" aria-label="Próxima página" disabled={pagina >= total} onClick={() => setPagina((p) => p + 1)} icone={<ChevronRight className="size-4" />} />
            </span>
          </div>
        </>
      )}
    </>
  );
}
