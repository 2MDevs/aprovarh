export interface Tag { id: string; nome: string; cor: string }
export interface StatusItem {
  id: string; nome: string; cor: string; ordem: number; final: boolean; sistema: boolean; chave: string | null;
  etapaPortal: Etapa; situacaoPortal: SituacaoEtapa; candidatos: number;
}
export type Etapa = 'candidatura' | 'analise' | 'entrevista' | 'resultado';
export type SituacaoEtapa = 'concluida' | 'em_andamento' | 'aguardando' | 'nao_iniciada';

export interface CandidatoLista {
  id: string; codigo: string; nome: string; unidade: { id: string; nome: string };
  status: { id: string; nome: string; cor: string }; fotoId: string | null; tags: Tag[];
  candidaturaEm: string; ultimaInteracaoEm: string; naoLidas: number;
  ultimaMensagem: { texto: string; autor: string; em: string } | null;
}
export interface PaginaCandidatos { total: number; pagina: number; porPagina: number; candidatos: CandidatoLista[] }

export interface Perfil {
  id: string; codigo: string; nome: string; sobrenome: string; telefone: string; cpf: string;
  unidade: { id: string; nome: string }; status: { id: string; nome: string; cor: string; final: boolean };
  fotoId: string | null; curriculoId: string | null; candidaturaEm: string; consentimentoEm: string;
  tags: Tag[];
  etapas: { etapa: Etapa; situacao: SituacaoEtapa; origem: 'automatica' | 'manual' }[];
  historico: {
    status: { em: string; autor_tipo: string; autor_nome: string | null; motivo: string | null; anterior: string | null; novo: string }[];
    tags: { em: string; acao: 'adicionada' | 'removida'; autor_nome: string | null; tag: string }[];
    candidaturas: { em: string; tipo: 'nova' | 'repetida' | 'reaberta'; nomeInformado: string; telefoneInformado: string | null; telefoneDiferente: boolean; unidadeDiferente: boolean; unidade: string }[];
  };
  arquivos: { id: string; nome: string; tipoMime: string; tamanho: number; tipo: 'curriculo' | 'foto' | 'anexo'; enviadoPor: string; em: string }[];
  observacoes: { id: string; texto: string | null; em: string; autor: string; minha: boolean }[] | null;
  portal: {
    ativo: { liberadoEm: string; expiraEm: string; permiteArquivo: boolean; primeiroUsoEm: string | null; origem: 'usuario' | 'automacao'; liberadaPor: string | null } | null;
    liberacoes: { liberadoEm: string; expiraEm: string; situacao: 'ativa' | 'expirada' | 'revogada'; origem: string; motivo: string | null; primeiroUsoEm: string | null; liberadaPor: string | null }[];
    acessos: { em: string; resultado: 'sucesso' | 'codigo_invalido' | 'expirado' | 'revogado'; ip: string | null; dispositivo: string | null }[];
  };
}

export interface Mensagem {
  id: string; sentido: 'entrada' | 'saida'; canal: 'portal' | 'whatsapp' | 'sistema'; autorTipo: 'candidato' | 'gestora' | 'chatbot' | 'sistema';
  autorNome: string | null; texto: string | null; visivelAoCandidato: boolean; situacaoEntrega: string | null; em: string;
  arquivo: { id: string; nome: string; tipoMime: string; tamanho: number } | null;
}

export const ROTULO_ETAPA: Record<Etapa, string> = { candidatura: 'Candidatura enviada', analise: 'Análise do currículo', entrevista: 'Entrevista', resultado: 'Resultado' };
export const ROTULO_SITUACAO: Record<SituacaoEtapa, string> = { concluida: 'Concluída', em_andamento: 'Em andamento', aguardando: 'Aguardando', nao_iniciada: 'Não iniciada' };

export const urlArquivo = (candidatoId: string, arquivoId: string, opcao?: 'miniatura' | 'baixar') =>
  `/api/central/candidatos/${candidatoId}/arquivos/${arquivoId}${opcao === 'miniatura' ? '?miniatura=1' : opcao === 'baixar' ? '?baixar=1' : ''}`;
