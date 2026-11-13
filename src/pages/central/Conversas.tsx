import { MessageSquareText } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSessao } from '../../app/sessao';
import { Carregando, ErroCarregar, SemPermissao } from '../../components/ui';
import { useEventos } from '../../lib/eventos';
import { useDados } from '../../lib/useDados';
import { Chat } from './Chat';
import { Foto, horaCurta, Pilula } from './comum';
import { Filtros, FILTRO_VAZIO, queryFiltros, type ValoresFiltro } from './Filtros';
import { PerfilCandidato } from './PerfilCandidato';
import type { CandidatoLista, PaginaCandidatos } from './tipos';

/**
 * Conversas: lista estilo WhatsApp Web | conversa | perfil lateral.
 * No celular: lista → conversa em tela cheia → perfil por cima.
 */
export function Conversas() {
  const { pode } = useSessao();
  const [params, setParams] = useSearchParams();
  const [filtro, setFiltro] = useState<ValoresFiltro>(FILTRO_VAZIO);
  const [porPagina, setPorPagina] = useState(40);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const selecionado = params.get('c');
  const lista = useDados<PaginaCandidatos>(pode('candidatos.ver') ? `/api/central/candidatos${queryFiltros(filtro, { porPagina })}` : null);
  const [versaoChat, setVersaoChat] = useState(0);
  const [versaoPerfil, setVersaoPerfil] = useState(0);

  // Tempo real: atualiza a lista (com pausa curta para juntar vários avisos) e a conversa aberta.
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEventos((tipo, d) => {
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => void lista.recarregar(), 300);
    if (d.candidatoId && d.candidatoId === selecionado) {
      if (tipo === 'mensagem.nova' || tipo === 'candidatura.nova') setVersaoChat((v) => v + 1);
      if (tipo === 'candidato.atualizado') setVersaoPerfil((v) => v + 1);
    }
  }, pode('candidatos.ver'));

  const escolher = useCallback((id: string | null) => {
    const p = new URLSearchParams(params);
    if (id) p.set('c', id);
    else p.delete('c');
    setParams(p, { replace: !id });
  }, [params, setParams]);

  useEffect(() => {
    if (!selecionado) setPerfilAberto(false);
  }, [selecionado]);

  if (!pode('candidatos.ver')) return <SemPermissao />;
  const itens = lista.dados?.candidatos ?? [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Lista */}
      <section className={`flex w-full flex-col border-r border-borda bg-superficie md:w-[340px] lg:w-[380px] ${selecionado ? 'hidden md:flex' : 'flex'}`} aria-label="Candidatos">
        <div className="space-y-3 border-b border-borda p-3">
          <h1 className="px-1 text-lg font-bold">Conversas</h1>
          <Filtros valor={filtro} onChange={setFiltro} compacto />
        </div>
        <div className="flex-1 overflow-y-auto">
          {lista.carregando && !lista.dados ? <Carregando /> : lista.erro ? <div className="p-4"><ErroCarregar mensagem={lista.erro.message} onTentar={lista.recarregar} /></div> : !itens.length ? (
            <p className="px-6 py-12 text-center text-sm text-suave">Nenhum candidato encontrado.</p>
          ) : (
            <ul>
              {itens.map((c) => <ItemLista key={c.id} c={c} ativo={c.id === selecionado} onClick={() => escolher(c.id)} />)}
            </ul>
          )}
          {lista.dados && lista.dados.total > itens.length && (
            <button className="w-full py-4 text-sm font-semibold text-suave hover:text-texto" onClick={() => setPorPagina((n) => Math.min(100, n + 40))}>
              Mostrar mais ({lista.dados.total - itens.length} restantes)
            </button>
          )}
        </div>
      </section>

      {/* Conversa */}
      <section className={`min-w-0 flex-1 flex-col bg-fundo ${selecionado ? 'flex' : 'hidden md:flex'}`} aria-label="Conversa">
        {selecionado ? (
          <Chat key={selecionado} candidatoId={selecionado} versao={versaoChat} onVoltar={() => escolher(null)}
            onAbrirPerfil={() => setPerfilAberto(true)} onLida={() => void lista.recarregar()} />
        ) : (
          <div className="m-auto max-w-sm px-6 text-center text-suave">
            <MessageSquareText className="mx-auto size-12 text-amarelo-forte" aria-hidden />
            <p className="mt-3 font-semibold text-texto">Escolha um candidato</p>
            <p className="mt-1 text-sm">As candidaturas novas e as mensagens aparecem na lista na hora, sem recarregar.</p>
          </div>
        )}
      </section>

      {/* Perfil lateral */}
      {selecionado && perfilAberto && (
        <>
          <div className="fixed inset-0 z-30 bg-grafite/40 xl:hidden" onClick={() => setPerfilAberto(false)} aria-hidden />
          <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[400px] overflow-y-auto border-l border-borda bg-superficie shadow-2xl xl:static xl:z-auto xl:shadow-none" aria-label="Perfil do candidato">
            <PerfilCandidato candidatoId={selecionado} versao={versaoPerfil} onFechar={() => setPerfilAberto(false)} onMudou={() => void lista.recarregar()} />
          </aside>
        </>
      )}
    </div>
  );
}

function ItemLista({ c, ativo, onClick }: { c: CandidatoLista; ativo: boolean; onClick: () => void }) {
  const quando = c.ultimaMensagem?.em ?? c.ultimaInteracaoEm;
  return (
    <li>
      <button onClick={onClick} aria-current={ativo ? 'true' : undefined}
        className={`flex w-full gap-3 border-b border-borda/70 px-3 py-3 text-left transition ${ativo ? 'bg-creme dark:bg-amarelo/10' : 'hover:bg-superficie-2'}`}>
        <Foto candidatoId={c.id} fotoId={c.fotoId} nome={c.nome} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`truncate ${c.naoLidas ? 'font-bold' : 'font-semibold'}`}>{c.nome}</span>
            <span className={`shrink-0 text-xs ${c.naoLidas ? 'font-bold text-verde dark:text-emerald-300' : 'text-suave'}`}>{horaCurta(quando)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={`truncate text-sm ${c.naoLidas ? 'text-texto' : 'text-suave'}`}>
              {c.ultimaMensagem ? `${c.ultimaMensagem.autor === 'gestora' ? 'Você: ' : ''}${c.ultimaMensagem.texto}` : 'Sem mensagens'}
            </span>
            {c.naoLidas > 0 && <span className="grid min-w-5 shrink-0 place-items-center rounded-full bg-verde px-1.5 text-[11px] font-bold text-white" aria-label={`${c.naoLidas} não lida(s)`}>{c.naoLidas}</span>}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Pilula cor={c.status.cor} pequena>{c.status.nome}</Pilula>
            <span className="text-[11px] text-suave">{c.unidade.nome}</span>
            {c.tags.slice(0, 2).map((t) => <Pilula key={t.id} cor={t.cor} pequena>{t.nome}</Pilula>)}
            {c.tags.length > 2 && <span className="text-[11px] text-suave">+{c.tags.length - 2}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
