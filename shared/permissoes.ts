/**
 * Catálogo único de permissões do aprovaRH.
 * O servidor confere estas chaves em toda rota; a tela usa as mesmas chaves para montar o menu.
 * Esconder um botão nunca é proteção: quem decide é o servidor.
 */

export const PERMISSOES = {
  // Central de RH (etapas 3 a 6; já reservadas para os perfis nascerem completos)
  'dashboard.ver': { grupo: 'Central de RH', nome: 'Ver a visão geral' },
  'candidatos.ver': { grupo: 'Central de RH', nome: 'Ver candidatos' },
  'candidatos.editar': { grupo: 'Central de RH', nome: 'Editar dados de candidatos' },
  'candidatos.excluir': { grupo: 'Central de RH', nome: 'Excluir candidatos' },
  'candidatos.curriculo.baixar': { grupo: 'Central de RH', nome: 'Ver e baixar currículo e foto' },
  'conversas.responder': { grupo: 'Central de RH', nome: 'Responder conversas' },
  'observacoes.ver': { grupo: 'Central de RH', nome: 'Ver e escrever observações internas' },
  'status.alterar': { grupo: 'Central de RH', nome: 'Alterar status e tags do candidato' },
  'status.configurar': { grupo: 'Central de RH', nome: 'Criar e editar status e tags' },
  'portal.liberar': { grupo: 'Central de RH', nome: 'Liberar e revogar acesso ao portal' },
  'entrevistas.agendar': { grupo: 'Entrevistas', nome: 'Agendar e remarcar entrevistas' },
  'disponibilidade.configurar': { grupo: 'Entrevistas', nome: 'Configurar disponibilidade das unidades' },
  'automacoes.ver': { grupo: 'Automações', nome: 'Ver automações e execuções' },
  'automacoes.editar': { grupo: 'Automações', nome: 'Criar e editar automações' },
  'automacoes.publicar': { grupo: 'Automações', nome: 'Publicar, ativar e pausar automações' },

  // Administração
  'unidades.gerenciar': { grupo: 'Administração', nome: 'Cadastrar e editar unidades' },
  'usuarios.gerenciar': { grupo: 'Administração', nome: 'Cadastrar usuários e definir perfis' },
  'perfis.gerenciar': { grupo: 'Administração', nome: 'Editar permissões dos perfis' },
  'dispositivos.gerenciar': { grupo: 'Administração', nome: 'Ver e gerenciar dispositivos de todos' },
  'auditoria.ver': { grupo: 'Administração', nome: 'Ver e exportar a auditoria' },
  'sistema.ver': { grupo: 'Administração', nome: 'Ver a tela Sistema' },
  'api.gerenciar': { grupo: 'Administração', nome: 'Criar chaves de API e webhooks' },
} as const;

export type Permissao = keyof typeof PERMISSOES;
export const TODAS_PERMISSOES = Object.keys(PERMISSOES) as Permissao[];

/** Perfis criados na instalação. O Desenvolvedor sempre tem tudo e mais as telas de infraestrutura. */
export const PERFIS_SISTEMA: Record<string, { nome: string; descricao: string; permissoes: Permissao[] }> = {
  desenvolvedor: {
    nome: 'Desenvolvedor',
    descricao: 'TI. Tudo, inclusive Integração e Atualização do sistema. Definido por DEVELOPER_EMAILS.',
    permissoes: TODAS_PERMISSOES,
  },
  diretoria: {
    nome: 'Diretoria / Administrador',
    descricao: 'Administra usuários, unidades e permissões; vê Sistema, Auditoria e Dispositivos.',
    permissoes: TODAS_PERMISSOES,
  },
  gestora_rh: {
    nome: 'Gestora de RH',
    descricao: 'Atende candidatos e conduz o processo seletivo nas unidades a que tem acesso.',
    permissoes: [
      'dashboard.ver', 'candidatos.ver', 'candidatos.editar', 'candidatos.curriculo.baixar',
      'conversas.responder', 'observacoes.ver', 'status.alterar', 'status.configurar', 'portal.liberar',
      'entrevistas.agendar', 'disponibilidade.configurar', 'automacoes.ver', 'automacoes.editar',
      'automacoes.publicar',
    ],
  },
  colaborador: {
    nome: 'Colaborador autorizado',
    descricao: 'Permissões escolhidas pelo administrador (ver decisão D7).',
    permissoes: ['candidatos.ver'],
  },
};

/** Escopos que uma chave de API pode receber (sempre limitados às permissões de quem a criou). */
export const ESCOPOS_API = {
  'unidades.ler': { nome: 'Ler unidades', exige: 'unidades.gerenciar' as Permissao },
} as const;
export type EscopoApi = keyof typeof ESCOPOS_API;
