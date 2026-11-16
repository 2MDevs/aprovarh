import type { Categoria } from '@shared/automacoes';

/** Cores por categoria (TELAS.md): Gatilho amarelo, Condição grafite, Ação vermelho, Tempo creme com borda. */
export const ESTILO: Record<Categoria, { faixa: string; barra: string; selo: string; texto: string; rotulo: string }> = {
  gatilho: { faixa: 'bg-amarelo', barra: 'bg-amarelo', selo: 'bg-amarelo text-grafite', texto: 'text-grafite', rotulo: 'Gatilho' },
  condicao: { faixa: 'bg-grafite dark:bg-[#5b5a55]', barra: 'bg-grafite dark:bg-[#8a8880]', selo: 'bg-grafite text-white dark:bg-[#5b5a55]', texto: 'text-white', rotulo: 'Condição' },
  acao: { faixa: 'bg-vermelho', barra: 'bg-vermelho', selo: 'bg-vermelho text-white', texto: 'text-white', rotulo: 'Ação' },
  tempo: { faixa: 'bg-creme border-b border-amarelo-forte', barra: 'bg-[#C9B24A]', selo: 'bg-creme text-grafite border border-amarelo-forte', texto: 'text-grafite', rotulo: 'Tempo' },
};

/** Cor da linha (SVG) por categoria de origem. */
export const COR_LINHA: Record<Categoria, string> = { gatilho: '#E9BD2B', condicao: '#57534E', acao: '#EA3324', tempo: '#B8A23A' };

export const SITUACAO_AUTOMACAO: Record<string, { rotulo: string; tom: 'verde' | 'cinza' | 'vermelho' | 'amarelo' }> = {
  rascunho: { rotulo: 'Rascunho', tom: 'cinza' },
  ativa: { rotulo: 'Ativa', tom: 'verde' },
  pausada: { rotulo: 'Pausada', tom: 'amarelo' },
  com_erro: { rotulo: 'Com erro', tom: 'vermelho' },
};

export const SITUACAO_EXECUCAO: Record<string, { rotulo: string; tom: 'verde' | 'cinza' | 'vermelho' | 'amarelo' }> = {
  em_andamento: { rotulo: 'Em andamento', tom: 'amarelo' },
  aguardando: { rotulo: 'Aguardando', tom: 'amarelo' },
  concluida: { rotulo: 'Concluída', tom: 'verde' },
  com_erro: { rotulo: 'Com erro', tom: 'vermelho' },
  interrompida: { rotulo: 'Interrompida', tom: 'cinza' },
};
