import type { Fluxo, Problema } from '@shared/automacoes';

export interface AutomacaoLista {
  id: string; nome: string; descricao: string | null; situacao: string; unidades: string[] | null; criador: string | null;
  atualizadaEm: string; rascunhoAlteradoEm: string; versao: number | null; gatilho: string | null; publicadaEm: string | null;
  execucoes: number; ativas: number; comErro: number; ultimaExecucao: string | null;
}

export interface Versao { id: string; numero: number; publicadaEm: string; publicadaPor: string | null; atual: boolean }

export interface AutomacaoDetalhe {
  id: string; nome: string; descricao: string | null; situacao: string; unidades: string[] | null; rascunhoAlteradoEm: string;
  fluxo: Fluxo; rascunhoDiferente: boolean; problemas: Problema[]; versoes: Versao[];
}

export interface Item { id: string; nome: string; cor?: string }
export interface Opcoes {
  status: Item[]; tags: Item[]; unidades: Item[]; todasUnidades: boolean;
  whatsapp: { configurado: boolean; provedor: 'meta' | 'evolution' };
}

export interface ExecucaoLista {
  id: string; numero: number; situacao: string; passos: number; erro: string | null; versao: number;
  iniciadaEm: string; atualizadaEm: string; finalizadaEm: string | null; candidato: { id: string; nome: string; codigo: string };
}

export interface PassoExecucao { noId: string; nome: string; categoria: string | null; situacao: string; saida: string | null; resumo: string | null; erro: string | null; tentativa: number; em: string }
export interface ExecucaoDetalhe {
  id: string; numero: number; situacao: string; erro: string | null; automacao: { id: string; nome: string }; versao: number; noAtual: string | null;
  candidato: { id: string; nome: string; codigo: string };
  passos: PassoExecucao[]; esperando: { noId: string; nome: string; tipo: string; ate: string }[];
}

export interface ResultadoTeste {
  passos: { noId: string; nome: string; categoria: string; saida: string | null; resumo: string; erro?: boolean }[];
  fim: string; nadaFoiEnviado: true;
  candidatoNoFim: { status: string | null; tags: string[]; entrevista: { situacao: string; data: string; hora: string } | null; acessoAtivo: boolean };
}
