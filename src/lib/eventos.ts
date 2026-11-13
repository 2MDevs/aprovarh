import { useEffect, useRef } from 'react';

/**
 * Tempo real: uma única conexão (EventSource) para a aplicação inteira.
 * O navegador reconecta sozinho se a conexão cair. Os eventos trazem só ids;
 * a tela busca os dados de novo pelas rotas normais.
 */
export type TipoEvento = 'mensagem.nova' | 'candidato.atualizado' | 'candidatura.nova' | 'conversa.lida';
export interface DadosEvento { candidatoId?: string; unidadeId?: string }
type Ouvinte = (tipo: TipoEvento, dados: DadosEvento) => void;

const TIPOS: TipoEvento[] = ['mensagem.nova', 'candidato.atualizado', 'candidatura.nova', 'conversa.lida'];
const ouvintes = new Set<Ouvinte>();
let fonte: EventSource | null = null;

function abrir() {
  if (fonte || typeof EventSource === 'undefined') return;
  fonte = new EventSource('/api/eventos');
  for (const t of TIPOS) {
    fonte.addEventListener(t, (e) => {
      let dados: DadosEvento = {};
      try {
        dados = JSON.parse((e as MessageEvent).data);
      } catch {
        /* ignora */
      }
      ouvintes.forEach((o) => o(t, dados));
    });
  }
}

function fechar() {
  fonte?.close();
  fonte = null;
}

/** Assina os eventos enquanto o componente estiver na tela. */
export function useEventos(ouvinte: Ouvinte, ativo = true) {
  const ref = useRef(ouvinte);
  ref.current = ouvinte;
  useEffect(() => {
    if (!ativo) return;
    const o: Ouvinte = (t, d) => ref.current(t, d);
    ouvintes.add(o);
    abrir();
    return () => {
      ouvintes.delete(o);
      if (!ouvintes.size) fechar();
    };
  }, [ativo]);
}
