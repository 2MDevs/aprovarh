/**
 * Catálogo de cards das automações e validação do fluxo.
 * O construtor (tela) e o motor (servidor) leem a mesma definição: o que a tela aceita é o que o motor executa.
 * Formato do fluxo: { nos: [{ id, tipo, params, posicao }], ligacoes: [{ id, de, saida, para }] }.
 */

export type Categoria = 'gatilho' | 'condicao' | 'acao' | 'tempo';
export const CATEGORIAS: Record<Categoria, string> = { gatilho: 'Gatilhos', condicao: 'Condições', acao: 'Ações', tempo: 'Tempo' };

export type TipoParametro =
  | 'texto' | 'textoLongo' | 'numero' | 'hora' | 'data' | 'booleano' | 'selecao'
  | 'status' | 'statusVarios' | 'tag' | 'unidades' | 'diasSemana' | 'no';

export interface Parametro {
  chave: string;
  rotulo: string;
  tipo: TipoParametro;
  obrigatorio?: boolean;
  opcoes?: { valor: string; rotulo: string }[];
  min?: number;
  max?: number;
  padrao?: unknown;
  ajuda?: string;
  /** Variáveis aceitas no texto (ex.: {nome}). */
  variaveis?: boolean;
}

/** Dados que um card precisa ter recebido de um card anterior (em todos os caminhos até ele). */
export type Dado = 'resposta' | 'codigo' | 'dataProposta' | 'horario' | 'periodo' | 'entrevista';

export interface DefCard {
  tipo: string;
  categoria: Categoria;
  nome: string;
  descricao: string;
  parametros: Parametro[];
  saidas: { id: string; rotulo: string }[];
  /** Gatilhos: tipos de evento de domínio que disparam. */
  eventos?: string[];
  /** Gatilho agendado (o Worker cria o evento no horário). */
  agendado?: boolean;
  /** Envia mensagem pelo WhatsApp: exige o WhatsApp configurado. */
  usaWhatsapp?: boolean;
  requer?: Dado[];
  produz?: Dado[];
  produzNaSaida?: Record<string, Dado[]>;
  /** Novas tentativas quando o passo falha por um problema temporário. */
  tentativas?: number;
}

const CANAL: Parametro = {
  chave: 'canal', rotulo: 'Canal', tipo: 'selecao', padrao: 'qualquer',
  opcoes: [{ valor: 'qualquer', rotulo: 'Qualquer canal' }, { valor: 'whatsapp', rotulo: 'WhatsApp' }, { valor: 'portal', rotulo: 'Portal' }],
};
const PROXIMO = [{ id: 'proximo', rotulo: '' }];
const SIM_NAO = [{ id: 'sim', rotulo: 'SIM' }, { id: 'nao', rotulo: 'NÃO' }];

export const VARIAVEIS: Record<string, { rotulo: string; requer?: Dado }> = {
  nome: { rotulo: 'Primeiro nome do candidato' },
  unidade: { rotulo: 'Unidade do candidato' },
  data_entrevista: { rotulo: 'Data da entrevista (por extenso)', requer: 'entrevista' },
  horario_entrevista: { rotulo: 'Horário da entrevista', requer: 'entrevista' },
  periodo_inicio: { rotulo: 'Primeiro dia com horário livre', requer: 'periodo' },
  periodo_fim: { rotulo: 'Último dia do período', requer: 'periodo' },
  link: { rotulo: 'Endereço do portal' },
};

export const CARDS: DefCard[] = [
  // ── A. Gatilhos ──────────────────────────────────────────────────────────
  { tipo: 'gatilho.candidato_cadastrado', categoria: 'gatilho', nome: 'Novo candidato cadastrado', descricao: 'Quando chega uma candidatura pelo formulário.',
    eventos: ['candidato.cadastrado', 'candidato.candidatura_repetida'], saidas: PROXIMO,
    parametros: [{ chave: 'incluirRepetidas', rotulo: 'Também quando a pessoa reenvia a candidatura', tipo: 'booleano', padrao: false }] },
  { tipo: 'gatilho.mensagem_recebida', categoria: 'gatilho', nome: 'Nova mensagem recebida', descricao: 'Quando o candidato escreve pelo WhatsApp ou pelo portal.',
    eventos: ['mensagem.recebida'], saidas: PROXIMO, produz: ['resposta'], parametros: [CANAL] },
  { tipo: 'gatilho.respondeu_sim', categoria: 'gatilho', nome: 'Candidato respondeu SIM', descricao: 'Quando a mensagem do candidato é um SIM (sim, confirmo, ok...).',
    eventos: ['mensagem.recebida'], saidas: PROXIMO, produz: ['resposta'], parametros: [CANAL] },
  { tipo: 'gatilho.respondeu_nao', categoria: 'gatilho', nome: 'Candidato respondeu NÃO', descricao: 'Quando a mensagem do candidato é um NÃO (não, não posso...).',
    eventos: ['mensagem.recebida'], saidas: PROXIMO, produz: ['resposta'], parametros: [CANAL] },
  { tipo: 'gatilho.data_entrevista', categoria: 'gatilho', nome: 'Data da entrevista chegou', descricao: 'No dia da entrevista (ou alguns dias antes), no horário escolhido. Vale para entrevistas aguardando confirmação ou confirmadas.',
    agendado: true, eventos: ['agenda.disparo'], saidas: PROXIMO, produz: ['entrevista'],
    parametros: [
      { chave: 'diasAntes', rotulo: 'Quantos dias antes', tipo: 'numero', min: 0, max: 7, padrao: 0, ajuda: '0 = no próprio dia da entrevista.' },
      { chave: 'hora', rotulo: 'Horário do disparo (Brasília)', tipo: 'hora', obrigatorio: true, padrao: '08:00' },
    ] },
  { tipo: 'gatilho.data_programada', categoria: 'gatilho', nome: 'Data programada chegou', descricao: 'Uma única vez, na data e no horário escolhidos, para os candidatos nos status escolhidos.',
    agendado: true, eventos: ['agenda.disparo'], saidas: PROXIMO,
    parametros: [
      { chave: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true },
      { chave: 'hora', rotulo: 'Horário (Brasília)', tipo: 'hora', obrigatorio: true },
      { chave: 'status', rotulo: 'Candidatos nos status', tipo: 'statusVarios', obrigatorio: true },
      { chave: 'tag', rotulo: 'E com a tag (opcional)', tipo: 'tag' },
    ] },
  { tipo: 'gatilho.horario_programado', categoria: 'gatilho', nome: 'Horário programado chegou', descricao: 'Todo dia escolhido, no horário escolhido, para os candidatos nos status escolhidos.',
    agendado: true, eventos: ['agenda.disparo'], saidas: PROXIMO,
    parametros: [
      { chave: 'hora', rotulo: 'Horário (Brasília)', tipo: 'hora', obrigatorio: true },
      { chave: 'dias', rotulo: 'Dias da semana', tipo: 'diasSemana', obrigatorio: true, padrao: [1, 2, 3, 4, 5] },
      { chave: 'status', rotulo: 'Candidatos nos status', tipo: 'statusVarios', obrigatorio: true },
      { chave: 'tag', rotulo: 'E com a tag (opcional)', tipo: 'tag' },
    ] },
  { tipo: 'gatilho.status_alterado', categoria: 'gatilho', nome: 'Status alterado', descricao: 'Quando o status do candidato muda.',
    eventos: ['candidato.status_alterado'], saidas: PROXIMO,
    parametros: [{ chave: 'status', rotulo: 'Só quando mudar para (opcional)', tipo: 'status' }] },
  { tipo: 'gatilho.tag_adicionada', categoria: 'gatilho', nome: 'Tag adicionada', descricao: 'Quando uma tag é colocada no candidato.',
    eventos: ['candidato.tag_adicionada'], saidas: PROXIMO, parametros: [{ chave: 'tag', rotulo: 'Tag', tipo: 'tag', obrigatorio: true }] },
  { tipo: 'gatilho.entrevista_agendada', categoria: 'gatilho', nome: 'Entrevista agendada', descricao: 'Quando uma entrevista é marcada.',
    eventos: ['entrevista.agendada'], saidas: PROXIMO, produz: ['entrevista'],
    parametros: [{ chave: 'incluirRemarcacoes', rotulo: 'Também quando for remarcada', tipo: 'booleano', padrao: true }] },
  { tipo: 'gatilho.entrevista_cancelada', categoria: 'gatilho', nome: 'Entrevista cancelada', descricao: 'Quando a entrevista é cancelada.',
    eventos: ['entrevista.cancelada'], saidas: PROXIMO, parametros: [] },
  { tipo: 'gatilho.acesso_liberado', categoria: 'gatilho', nome: 'Acesso temporário liberado', descricao: 'Quando um código do portal é gerado.',
    eventos: ['acesso.liberado'], saidas: PROXIMO, parametros: [] },
  { tipo: 'gatilho.acesso_expirado', categoria: 'gatilho', nome: 'Acesso expirado', descricao: 'Quando o código do dia vence (23h59).',
    eventos: ['acesso.expirado'], saidas: PROXIMO, parametros: [] },

  // ── B. Condições ─────────────────────────────────────────────────────────
  { tipo: 'condicao.se', categoria: 'condicao', nome: 'Se / Então', descricao: 'Confere uma situação e segue pelo SIM ou pelo NÃO.', saidas: SIM_NAO,
    parametros: [
      { chave: 'campo', rotulo: 'Se', tipo: 'selecao', obrigatorio: true, opcoes: [
        { valor: 'resposta_contem', rotulo: 'a resposta contém a palavra' },
        { valor: 'antes_de', rotulo: 'agora é antes do horário' },
        { valor: 'dia_semana', rotulo: 'hoje é dia útil (segunda a sexta)' },
        { valor: 'tem_entrevista', rotulo: 'o candidato tem entrevista marcada' },
      ] },
      { chave: 'valor', rotulo: 'Valor (palavra ou horário HH:MM)', tipo: 'texto', ajuda: 'Só para "a resposta contém" e "antes do horário".' },
    ] },
  { tipo: 'condicao.resposta_sim_nao', categoria: 'condicao', nome: 'Verificar resposta SIM ou NÃO', descricao: 'Lê a última resposta do candidato.', requer: ['resposta'],
    saidas: [...SIM_NAO, { id: 'outro', rotulo: 'Não entendi' }], parametros: [] },
  { tipo: 'condicao.unidade', categoria: 'condicao', nome: 'Verificar unidade pretendida', descricao: 'O candidato é de uma destas unidades?', saidas: SIM_NAO,
    parametros: [{ chave: 'unidades', rotulo: 'Unidades', tipo: 'unidades', obrigatorio: true }] },
  { tipo: 'condicao.status', categoria: 'condicao', nome: 'Verificar status', descricao: 'O candidato está em um destes status?', saidas: SIM_NAO,
    parametros: [{ chave: 'status', rotulo: 'Status', tipo: 'statusVarios', obrigatorio: true }] },
  { tipo: 'condicao.tag', categoria: 'condicao', nome: 'Verificar tag', descricao: 'O candidato tem esta tag?', saidas: SIM_NAO,
    parametros: [{ chave: 'tag', rotulo: 'Tag', tipo: 'tag', obrigatorio: true }] },
  { tipo: 'condicao.data', categoria: 'condicao', nome: 'Verificar data', descricao: 'A resposta do candidato traz uma data válida dentro do período oferecido?',
    requer: ['resposta'], produzNaSaida: { sim: ['dataProposta'] }, saidas: SIM_NAO,
    parametros: [{ chave: 'dias', rotulo: 'Aceitar datas até quantos dias à frente', tipo: 'numero', min: 1, max: 120, padrao: 30 }] },
  { tipo: 'condicao.disponibilidade', categoria: 'condicao', nome: 'Verificar disponibilidade', descricao: 'Há horário livre na data informada? Se o candidato disse o horário, usa esse; senão, o primeiro livre do dia.',
    requer: ['dataProposta'], produzNaSaida: { sim: ['horario'] }, saidas: SIM_NAO, parametros: [] },
  { tipo: 'condicao.codigo_valido', categoria: 'condicao', nome: 'Verificar se o código está válido', descricao: 'O candidato tem acesso ao portal liberado agora?', saidas: SIM_NAO, parametros: [] },
  { tipo: 'condicao.entrevista_confirmada', categoria: 'condicao', nome: 'Verificar se a entrevista foi confirmada', descricao: 'A entrevista marcada está confirmada?', saidas: SIM_NAO, parametros: [] },

  // ── C. Ações ─────────────────────────────────────────────────────────────
  { tipo: 'acao.whatsapp_mensagem', categoria: 'acao', nome: 'Enviar mensagem pelo WhatsApp', descricao: 'Texto livre, enviado para o número do candidato.',
    usaWhatsapp: true, saidas: PROXIMO, tentativas: 3,
    parametros: [
      { chave: 'texto', rotulo: 'Mensagem', tipo: 'textoLongo', obrigatorio: true, variaveis: true },
    ] },
  { tipo: 'acao.chat_mensagem', categoria: 'acao', nome: 'Enviar mensagem pelo chat interno', descricao: 'Aparece para o candidato no portal.', saidas: PROXIMO,
    parametros: [{ chave: 'texto', rotulo: 'Mensagem', tipo: 'textoLongo', obrigatorio: true, variaveis: true }] },
  { tipo: 'acao.gerar_codigo', categoria: 'acao', nome: 'Gerar código de acesso', descricao: 'Libera o portal até 23h59 de hoje. O código só existe até o card "Enviar link de acesso".',
    produz: ['codigo'], saidas: PROXIMO, parametros: [{ chave: 'permiteArquivo', rotulo: 'Permitir envio de arquivos', tipo: 'booleano', padrao: false }] },
  { tipo: 'acao.enviar_link', categoria: 'acao', nome: 'Enviar link de acesso', descricao: 'Envia o link do portal e o código gerado pelo WhatsApp.', usaWhatsapp: true, requer: ['codigo'], saidas: PROXIMO, tentativas: 3, parametros: [] },
  { tipo: 'acao.liberar_acesso', categoria: 'acao', nome: 'Liberar acesso', descricao: 'Gera o código e já envia o link pelo WhatsApp (os dois cards anteriores em um).', usaWhatsapp: true, saidas: PROXIMO, tentativas: 3,
    parametros: [{ chave: 'permiteArquivo', rotulo: 'Permitir envio de arquivos', tipo: 'booleano', padrao: false }] },
  { tipo: 'acao.revogar_acesso', categoria: 'acao', nome: 'Revogar acesso', descricao: 'Encerra o acesso ao portal na hora.', saidas: PROXIMO, parametros: [] },
  { tipo: 'acao.alterar_status', categoria: 'acao', nome: 'Alterar status', descricao: 'Muda o status (a linha do tempo acompanha).', saidas: PROXIMO,
    parametros: [{ chave: 'status', rotulo: 'Novo status', tipo: 'status', obrigatorio: true }] },
  { tipo: 'acao.adicionar_tag', categoria: 'acao', nome: 'Adicionar tag', descricao: 'Coloca uma tag no candidato.', saidas: PROXIMO, parametros: [{ chave: 'tag', rotulo: 'Tag', tipo: 'tag', obrigatorio: true }] },
  { tipo: 'acao.remover_tag', categoria: 'acao', nome: 'Remover tag', descricao: 'Tira uma tag do candidato.', saidas: PROXIMO, parametros: [{ chave: 'tag', rotulo: 'Tag', tipo: 'tag', obrigatorio: true }] },
  { tipo: 'acao.consultar_disponibilidade', categoria: 'acao', nome: 'Consultar disponibilidade', descricao: 'Procura os dias com horário livre na unidade do candidato.',
    produzNaSaida: { sim: ['periodo'] }, saidas: [{ id: 'sim', rotulo: 'Há horários' }, { id: 'nao', rotulo: 'Sem horários' }],
    parametros: [{ chave: 'dias', rotulo: 'Procurar nos próximos (dias)', tipo: 'numero', min: 1, max: 120, padrao: 30 }] },
  { tipo: 'acao.agendar_entrevista', categoria: 'acao', nome: 'Agendar entrevista', descricao: 'Marca (ou remarca) no horário escolhido. Nunca marca horário sem vaga.',
    requer: ['horario'], produz: ['entrevista'], saidas: [{ id: 'proximo', rotulo: 'Agendada' }, { id: 'indisponivel', rotulo: 'Horário ocupado' }], parametros: [] },
  { tipo: 'acao.enviar_confirmacao', categoria: 'acao', nome: 'Pedir confirmação da entrevista', descricao: 'Envia "Sua entrevista foi agendada para... Responda SIM ou NÃO." pelo WhatsApp.',
    usaWhatsapp: true, saidas: PROXIMO, tentativas: 3, parametros: [] },
  { tipo: 'acao.atualizar_entrevista', categoria: 'acao', nome: 'Atualizar entrevista', descricao: 'Confirma, pede remarcação, cancela ou registra o resultado.', saidas: PROXIMO,
    parametros: [{ chave: 'acao', rotulo: 'O que fazer', tipo: 'selecao', obrigatorio: true, opcoes: [
      { valor: 'confirmar', rotulo: 'Confirmar' }, { valor: 'solicitar_remarcacao', rotulo: 'Marcar "pediu outra data"' }, { valor: 'cancelar', rotulo: 'Cancelar' },
      { valor: 'realizada', rotulo: 'Registrar como realizada' }, { valor: 'nao_compareceu', rotulo: 'Registrar falta' },
    ] }] },
  { tipo: 'acao.registrar_resposta', categoria: 'acao', nome: 'Registrar resposta', descricao: 'Guarda a resposta do candidato no histórico da entrevista (ou da conversa).', requer: ['resposta'], saidas: PROXIMO, parametros: [] },
  { tipo: 'acao.notificar_gestora', categoria: 'acao', nome: 'Notificar gestora', descricao: 'Aviso no sino para quem cuida da unidade do candidato.', saidas: PROXIMO,
    parametros: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true, max: 120 },
      { chave: 'texto', rotulo: 'Texto', tipo: 'textoLongo', obrigatorio: true, variaveis: true },
    ] },

  // ── D. Tempo ─────────────────────────────────────────────────────────────
  { tipo: 'tempo.aguardar_periodo', categoria: 'tempo', nome: 'Aguardar um período', descricao: 'Espera e continua.', saidas: PROXIMO,
    parametros: [
      { chave: 'quantidade', rotulo: 'Quanto', tipo: 'numero', obrigatorio: true, min: 1, max: 999, padrao: 1 },
      { chave: 'unidade', rotulo: 'Unidade', tipo: 'selecao', padrao: 'horas', opcoes: [{ valor: 'minutos', rotulo: 'minutos' }, { valor: 'horas', rotulo: 'horas' }, { valor: 'dias', rotulo: 'dias' }] },
    ] },
  { tipo: 'tempo.aguardar_data', categoria: 'tempo', nome: 'Aguardar uma data', descricao: 'Espera até a data escolhida ou até perto da entrevista.', saidas: PROXIMO,
    parametros: [
      { chave: 'referencia', rotulo: 'Até', tipo: 'selecao', padrao: 'fixa', opcoes: [{ valor: 'fixa', rotulo: 'uma data fixa' }, { valor: 'entrevista', rotulo: 'horas antes da entrevista' }] },
      { chave: 'data', rotulo: 'Data (se fixa)', tipo: 'data' },
      { chave: 'hora', rotulo: 'Horário (se fixa)', tipo: 'hora', padrao: '09:00' },
      { chave: 'horasAntes', rotulo: 'Horas antes da entrevista', tipo: 'numero', min: 0, max: 168, padrao: 2 },
    ] },
  { tipo: 'tempo.aguardar_horario', categoria: 'tempo', nome: 'Aguardar horário', descricao: 'Espera até o próximo horário escolhido (hoje ou amanhã).', saidas: PROXIMO,
    parametros: [{ chave: 'hora', rotulo: 'Horário (Brasília)', tipo: 'hora', obrigatorio: true }] },
  { tipo: 'tempo.aguardar_resposta', categoria: 'tempo', nome: 'Aguardar resposta', descricao: 'Espera o candidato escrever. Enquanto espera, as respostas automáticas da etapa 7 ficam caladas.',
    produzNaSaida: { respondeu: ['resposta'] }, saidas: [{ id: 'respondeu', rotulo: 'Respondeu' }, { id: 'tempo_esgotado', rotulo: 'Tempo esgotado' }],
    parametros: [{ chave: 'prazoHoras', rotulo: 'Esperar até (horas)', tipo: 'numero', obrigatorio: true, min: 1, max: 336, padrao: 24 }, CANAL] },
  { tipo: 'tempo.executar_em_dia', categoria: 'tempo', nome: 'Executar em determinado dia', descricao: 'Espera o próximo dia da semana escolhido, no horário escolhido.', saidas: PROXIMO,
    parametros: [
      { chave: 'dias', rotulo: 'Dias da semana', tipo: 'diasSemana', obrigatorio: true, padrao: [1] },
      { chave: 'hora', rotulo: 'Horário (Brasília)', tipo: 'hora', obrigatorio: true, padrao: '09:00' },
    ] },
  { tipo: 'tempo.expirar_autorizacao', categoria: 'tempo', nome: 'Expirar autorização', descricao: 'Espera o tempo escolhido e revoga o acesso ao portal (antes das 23h59, se quiser).', saidas: PROXIMO,
    parametros: [{ chave: 'horas', rotulo: 'Revogar depois de (horas)', tipo: 'numero', obrigatorio: true, min: 1, max: 23, padrao: 2 }] },
  { tipo: 'tempo.repetir', categoria: 'tempo', nome: 'Repetir tentativa', descricao: 'Volta para um card anterior, até o limite. Depois do limite, segue por "Limite atingido".',
    saidas: [{ id: 'esgotou', rotulo: 'Limite atingido' }],
    parametros: [
      { chave: 'alvo', rotulo: 'Voltar para o card', tipo: 'no', obrigatorio: true },
      { chave: 'limite', rotulo: 'Quantas vezes no máximo', tipo: 'numero', obrigatorio: true, min: 1, max: 10, padrao: 2 },
    ] },
];

export const CARD: Record<string, DefCard> = Object.fromEntries(CARDS.map((c) => [c.tipo, c]));

// ── Fluxo ───────────────────────────────────────────────────────────────────
export interface No { id: string; tipo: string; params: Record<string, unknown>; posicao: { x: number; y: number }; nome?: string }
export interface Ligacao { id: string; de: string; saida: string; para: string }
export interface Fluxo { nos: No[]; ligacoes: Ligacao[] }

export const LIMITES = { nos: 60, passosPorExecucao: 100, profundidadeCadeia: 3, textoMax: 1000 };

export interface Problema { noId?: string; mensagem: string; aviso?: boolean }

/** O que a validação precisa saber do banco (opcional: sem isso, confere só a estrutura). */
export interface ContextoValidacao {
  statusIds?: string[];
  tagIds?: string[];
  unidadeIds?: string[];
  whatsappConfigurado?: boolean;
  provedor?: 'meta' | 'evolution';
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const vazio = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const nomeDo = (n: No) => n.nome || CARD[n.tipo]?.nome || n.tipo;

/** Valor do parâmetro, já com o padrão do catálogo. */
export function param<T = unknown>(no: No, chave: string): T {
  const def = CARD[no.tipo]?.parametros.find((p) => p.chave === chave);
  const v = no.params?.[chave];
  return (vazio(v) ? def?.padrao : v) as T;
}

export function variaveisDoTexto(texto: string): string[] {
  return [...texto.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
}

/** Próximo nó por uma saída (ou null: o fluxo termina ali). */
export function proximoNo(f: Fluxo, deId: string, saida: string): No | null {
  const l = f.ligacoes.find((x) => x.de === deId && x.saida === saida);
  return l ? f.nos.find((n) => n.id === l.para) ?? null : null;
}

export function gatilhoDo(f: Fluxo): No | null {
  return f.nos.find((n) => CARD[n.tipo]?.categoria === 'gatilho') ?? null;
}

/**
 * Validação antes de publicar (a mesma na tela e no servidor).
 * Devolve a lista de problemas; os marcados como `aviso` não impedem a publicação.
 */
export function validarFluxo(f: Fluxo, ctx: ContextoValidacao = {}): Problema[] {
  const p: Problema[] = [];
  if (!f || !Array.isArray(f.nos) || !Array.isArray(f.ligacoes)) return [{ mensagem: 'Fluxo em formato inválido.' }];
  if (!f.nos.length) return [{ mensagem: 'O fluxo está vazio. Comece por um gatilho.' }];
  if (f.nos.length > LIMITES.nos) p.push({ mensagem: `O fluxo pode ter no máximo ${LIMITES.nos} cards.` });

  const ids = new Set<string>();
  for (const n of f.nos) {
    if (!n.id || ids.has(n.id)) p.push({ noId: n.id, mensagem: 'Card com identificação repetida.' });
    ids.add(n.id);
    if (!CARD[n.tipo]) p.push({ noId: n.id, mensagem: `Card desconhecido: ${n.tipo}.` });
  }
  const porId = new Map(f.nos.map((n) => [n.id, n]));

  const gatilhos = f.nos.filter((n) => CARD[n.tipo]?.categoria === 'gatilho');
  if (gatilhos.length === 0) p.push({ mensagem: 'Falta o gatilho: todo fluxo começa com um card de Gatilho.' });
  if (gatilhos.length > 1) for (const g of gatilhos.slice(1)) p.push({ noId: g.id, mensagem: 'Só pode haver um gatilho por fluxo.' });

  // Ligações
  const entradas = new Map<string, number>();
  const usadas = new Set<string>();
  for (const l of f.ligacoes) {
    const de = porId.get(l.de);
    const para = porId.get(l.para);
    if (!de || !para) { p.push({ mensagem: 'Há uma ligação para um card que não existe.' }); continue; }
    const def = CARD[de.tipo];
    if (def && !def.saidas.some((s) => s.id === l.saida)) p.push({ noId: de.id, mensagem: `Saída "${l.saida}" não existe neste card.` });
    if (CARD[para.tipo]?.categoria === 'gatilho') p.push({ noId: para.id, mensagem: 'Nada pode ligar para o gatilho: ele é sempre o começo.' });
    if (l.de === l.para) p.push({ noId: de.id, mensagem: 'Um card não pode ligar nele mesmo.' });
    const chave = `${l.de}:${l.saida}`;
    if (usadas.has(chave)) p.push({ noId: de.id, mensagem: 'Cada saída liga em um card só.' });
    usadas.add(chave);
    entradas.set(l.para, (entradas.get(l.para) ?? 0) + 1);
  }

  // Ciclos (o fluxo é um grafo sem voltas; repetir é só pelo card "Repetir tentativa")
  const filhos = (id: string) => f.ligacoes.filter((l) => l.de === id).map((l) => l.para);
  const cor = new Map<string, 0 | 1 | 2>();
  let ciclo = false;
  const visitar = (id: string) => {
    cor.set(id, 1);
    for (const c of filhos(id)) {
      if (cor.get(c) === 1) ciclo = true;
      else if (!cor.get(c)) visitar(c);
    }
    cor.set(id, 2);
  };
  for (const n of f.nos) if (!cor.get(n.id)) visitar(n.id);
  if (ciclo) p.push({ mensagem: 'O fluxo tem uma volta (ciclo). Para repetir, use o card "Repetir tentativa".' });

  // Cards soltos e alcance a partir do gatilho
  const g = gatilhos[0];
  const alcancados = new Set<string>();
  if (g) {
    const pilha = [g.id];
    while (pilha.length) {
      const id = pilha.pop()!;
      if (alcancados.has(id)) continue;
      alcancados.add(id);
      pilha.push(...filhos(id));
    }
  }
  for (const n of f.nos) {
    if (CARD[n.tipo]?.categoria === 'gatilho') continue;
    if (!entradas.get(n.id)) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}" está solto: ligue algum card nele.` });
    else if (g && !alcancados.has(n.id)) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}" não é alcançado a partir do gatilho.` });
  }
  if (g && !f.ligacoes.some((l) => l.de === g.id)) p.push({ noId: g.id, mensagem: 'Ligue o gatilho no primeiro card do fluxo.' });

  // Parâmetros
  for (const n of f.nos) {
    const def = CARD[n.tipo];
    if (!def) continue;
    for (const par of def.parametros) {
      const v = param(n, par.chave);
      if (vazio(v)) {
        if (par.obrigatorio) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": preencha "${par.rotulo}".` });
        continue;
      }
      const erro = conferirParametro(par, v, ctx, f, n);
      if (erro) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": ${erro}` });
    }
    if (def.usaWhatsapp && ctx.whatsappConfigurado === false) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}" usa o WhatsApp, mas a Evolution API ainda não foi configurada (Integração › WhatsApp). Depois conecte o celular em "Conexão do WhatsApp".` });
    if (n.tipo === 'acao.whatsapp_mensagem' && ctx.provedor === 'meta') {
      p.push({ noId: n.id, aviso: true, mensagem: `"${nomeDo(n)}": na Meta, texto livre só sai até 24 h depois da última mensagem do candidato.` });
    }
    if (n.tipo === 'condicao.se') {
      const campo = param<string>(n, 'campo');
      const valor = String(param(n, 'valor') ?? '');
      if (campo === 'resposta_contem' && !valor.trim()) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": escreva a palavra.` });
      if (campo === 'antes_de' && !HORA.test(valor)) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": escreva o horário no formato HH:MM.` });
    }
    if (n.tipo === 'tempo.aguardar_data' && param(n, 'referencia') === 'fixa' && vazio(param(n, 'data'))) {
      p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": escolha a data.` });
    }
    // Condições: avisar quando uma saída fica sem continuação (o fluxo termina ali, o que pode ser de propósito).
    if (def.categoria === 'condicao' || n.tipo === 'tempo.aguardar_resposta') {
      for (const s of def.saidas) if (!usadas.has(`${n.id}:${s.id}`)) p.push({ noId: n.id, aviso: true, mensagem: `"${nomeDo(n)}": a saída "${s.rotulo}" não continua (o fluxo termina ali).` });
    }
  }

  // Dados que precisam vir de um card anterior em todos os caminhos.
  if (g && !ciclo) {
    const disponiveis = calcularDisponiveis(f, g);
    for (const n of f.nos) {
      const def = CARD[n.tipo];
      const tem = disponiveis.get(n.id);
      if (!def || !tem) continue;
      for (const r of def.requer ?? []) if (!tem.has(r)) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}" depende de ${DESCRICAO_DADO[r]}, que precisa vir antes dele em todos os caminhos.` });
      for (const par of def.parametros.filter((x) => x.variaveis)) {
        for (const v of variaveisDoTexto(String(param(n, par.chave) ?? ''))) {
          const info = VARIAVEIS[v];
          if (!info) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": a variável {${v}} não existe.` });
          else if (info.requer && !tem.has(info.requer)) p.push({ noId: n.id, mensagem: `"${nomeDo(n)}": {${v}} depende de ${DESCRICAO_DADO[info.requer]}, que precisa vir antes.` });
        }
      }
    }
  }
  return p;
}

const DESCRICAO_DADO: Record<Dado, string> = {
  resposta: 'uma resposta do candidato ("Aguardar resposta" ou gatilho de mensagem)',
  codigo: 'um código gerado (card "Gerar código de acesso")',
  dataProposta: 'uma data conferida (card "Verificar data", saída SIM)',
  horario: 'um horário livre (card "Verificar disponibilidade", saída SIM)',
  periodo: 'um período com horários (card "Consultar disponibilidade", saída "Há horários")',
  entrevista: 'uma entrevista marcada (gatilho de entrevista ou "Agendar entrevista")',
};

/** Dados disponíveis ao entrar em cada nó: interseção do que chega por todos os caminhos. */
function calcularDisponiveis(f: Fluxo, g: No): Map<string, Set<Dado>> {
  const ordem: string[] = [];
  const vistos = new Set<string>();
  const dfs = (id: string) => {
    if (vistos.has(id)) return;
    vistos.add(id);
    for (const l of f.ligacoes.filter((x) => x.de === id)) dfs(l.para);
    ordem.push(id);
  };
  dfs(g.id);
  ordem.reverse(); // ordem topológica
  const entrada = new Map<string, Set<Dado>>([[g.id, new Set()]]);
  const porId = new Map(f.nos.map((n) => [n.id, n]));
  for (const id of ordem) {
    const n = porId.get(id)!;
    const def = CARD[n.tipo];
    const atual = entrada.get(id) ?? new Set<Dado>();
    for (const l of f.ligacoes.filter((x) => x.de === id)) {
      const sai = new Set<Dado>([...atual, ...(def?.produz ?? []), ...(def?.produzNaSaida?.[l.saida] ?? [])]);
      const antes = entrada.get(l.para);
      entrada.set(l.para, antes ? new Set([...antes].filter((d) => sai.has(d))) : sai);
    }
  }
  return entrada;
}

function conferirParametro(par: Parametro, v: unknown, ctx: ContextoValidacao, f: Fluxo, no: No): string | null {
  const lista = (x: unknown) => (Array.isArray(x) ? x.map(String) : [String(x)]);
  switch (par.tipo) {
    case 'numero': {
      const n = Number(v);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return `"${par.rotulo}" precisa ser um número inteiro.`;
      if (par.min !== undefined && n < par.min) return `"${par.rotulo}" precisa ser pelo menos ${par.min}.`;
      if (par.max !== undefined && n > par.max) return `"${par.rotulo}" pode ser no máximo ${par.max}.`;
      return null;
    }
    case 'hora': return HORA.test(String(v)) ? null : `"${par.rotulo}" precisa estar no formato HH:MM.`;
    case 'data': return DATA.test(String(v)) && !Number.isNaN(Date.parse(String(v))) ? null : `"${par.rotulo}" precisa ser uma data válida.`;
    case 'booleano': return typeof v === 'boolean' ? null : `"${par.rotulo}" precisa ser sim ou não.`;
    case 'selecao': return par.opcoes?.some((o) => o.valor === v) ? null : `escolha uma opção em "${par.rotulo}".`;
    case 'texto': case 'textoLongo': {
      const t = String(v);
      const max = par.max ?? LIMITES.textoMax;
      return t.length > max ? `"${par.rotulo}" pode ter no máximo ${max} caracteres.` : null;
    }
    case 'diasSemana': return lista(v).every((d) => /^[0-6]$/.test(d)) ? null : `"${par.rotulo}" tem um dia inválido.`;
    case 'status': case 'statusVarios':
      return ctx.statusIds && lista(v).some((id) => !ctx.statusIds!.includes(id)) ? `um status escolhido não existe mais.` : null;
    case 'tag': return ctx.tagIds && !ctx.tagIds.includes(String(v)) ? 'a tag escolhida não existe mais.' : null;
    case 'unidades': return ctx.unidadeIds && lista(v).some((id) => !ctx.unidadeIds!.includes(id)) ? 'uma unidade escolhida não existe ou você não tem acesso a ela.' : null;
    case 'no': {
      const alvo = f.nos.find((n) => n.id === v);
      if (!alvo) return 'escolha o card para onde voltar.';
      if (CARD[alvo.tipo]?.categoria === 'gatilho') return 'não dá para voltar para o gatilho.';
      if (!ehAnterior(f, alvo.id, no.id)) return 'só dá para voltar para um card que vem antes deste.';
      return null;
    }
  }
  return null;
}

/** `a` vem antes de `b` em algum caminho? */
function ehAnterior(f: Fluxo, a: string, b: string): boolean {
  const pilha = [a];
  const vistos = new Set<string>();
  while (pilha.length) {
    const id = pilha.pop()!;
    if (id === b) return id !== a;
    if (vistos.has(id)) continue;
    vistos.add(id);
    pilha.push(...f.ligacoes.filter((l) => l.de === id).map((l) => l.para));
  }
  return false;
}


// ── Disposição dos cards (usada pelo botão "Organizar" e pelo modelo) ───────
/** Tamanho fixo dos cards na área: deixa as ligações previsíveis (entrada no topo, saídas embaixo). */
export const LARGURA = 248;
export const ALTURA = 92;
const ESPACO_X = 72;
const ESPACO_Y = 92;

/**
 * Organizar: camadas de cima para baixo, pela maior distância a partir do gatilho.
 * Cards soltos vão para uma coluna à direita. Dentro da camada, segue a ordem das saídas do pai.
 */
export function organizar(f: Fluxo): Fluxo {
  const filhos = new Map<string, string[]>();
  for (const n of f.nos) filhos.set(n.id, []);
  for (const n of f.nos) {
    const ordem = (CARD[n.tipo]?.saidas ?? []).map((s) => s.id);
    const ls = f.ligacoes.filter((l) => l.de === n.id).sort((a, b) => ordem.indexOf(a.saida) - ordem.indexOf(b.saida));
    filhos.set(n.id, ls.map((l) => l.para));
  }
  const g = f.nos.find((n) => CARD[n.tipo]?.categoria === 'gatilho');
  const nivel = new Map<string, number>();
  if (g) {
    // maior caminho (o fluxo é sem ciclos; o limite evita travar se houver um)
    nivel.set(g.id, 0);
    for (let volta = 0; volta < f.nos.length; volta++) {
      let mudou = false;
      for (const [id, n] of nivel) {
        for (const c of filhos.get(id) ?? []) {
          if ((nivel.get(c) ?? -1) < n + 1) {
            nivel.set(c, n + 1);
            mudou = true;
          }
        }
      }
      if (!mudou) break;
    }
  }
  // ordem horizontal: percorre em profundidade a partir do gatilho
  const ordemX = new Map<string, number>();
  let contador = 0;
  const visitar = (id: string) => {
    if (ordemX.has(id)) return;
    ordemX.set(id, contador++);
    for (const c of filhos.get(id) ?? []) visitar(c);
  };
  if (g) visitar(g.id);

  const camadas = new Map<number, string[]>();
  for (const [id, n] of nivel) camadas.set(n, [...(camadas.get(n) ?? []), id]);
  const pos = new Map<string, { x: number; y: number }>();
  let maiorLargura = 0;
  for (const ids of camadas.values()) maiorLargura = Math.max(maiorLargura, ids.length);
  for (const [n, ids] of camadas) {
    ids.sort((a, b) => (ordemX.get(a) ?? 0) - (ordemX.get(b) ?? 0));
    const deslocamento = ((maiorLargura - ids.length) * (LARGURA + ESPACO_X)) / 2;
    ids.forEach((id, i) => pos.set(id, { x: deslocamento + i * (LARGURA + ESPACO_X), y: n * (ALTURA + ESPACO_Y) }));
  }
  const soltos = f.nos.filter((n) => !pos.has(n.id));
  const xSoltos = maiorLargura * (LARGURA + ESPACO_X) + ESPACO_X;
  soltos.forEach((n, i) => pos.set(n.id, { x: xSoltos, y: i * (ALTURA + 32) }));
  return { ...f, nos: f.nos.map((n) => ({ ...n, posicao: pos.get(n.id)! })) };
}


/**
 * Fluxo de referência (seção 9.4 do prompt): vem como modelo, nunca ativo.
 * Status e tags ficam em branco de propósito: a gestora escolhe ao duplicar (a validação aponta).
 */
export function fluxoDeReferencia(): Fluxo {
  const nos: No[] = [];
  const ligacoes: Ligacao[] = [];
  let y = 0;
  const no = (id: string, tipo: string, params: Record<string, unknown>, x: number, nome?: string) => {
    nos.push({ id, tipo, params, posicao: { x, y }, nome });
    y += 140;
  };
  const liga = (de: string, saida: string, para: string) => ligacoes.push({ id: `l_${de}_${saida}`, de, saida, para });

  no('gatilho', 'gatilho.data_entrevista', { diasAntes: 0, hora: '08:00' }, 0);
  no('codigo', 'acao.gerar_codigo', { permiteArquivo: false }, 0);
  no('link', 'acao.enviar_link', {}, 0, 'Enviar link e código pelo WhatsApp');
  no('pergunta', 'acao.enviar_confirmacao', {}, 0, 'Perguntar se confirma presença');
  no('espera', 'tempo.aguardar_resposta', { prazoHoras: 4, canal: 'qualquer' }, 0);
  no('confirmou', 'condicao.resposta_sim_nao', {}, 0, 'Candidato confirmou presença?');
  const ySim = y;
  // Ramo SIM
  no('sim_confirmar', 'acao.atualizar_entrevista', { acao: 'confirmar' }, -360, 'Confirmar entrevista');
  no('sim_status', 'acao.alterar_status', {}, -360, 'Atualizar status');
  no('sim_tag', 'acao.adicionar_tag', {}, -360, 'Atualizar tag');
  no('sim_avisar', 'acao.notificar_gestora', { titulo: 'Entrevista confirmada', texto: '{nome} confirmou a entrevista de hoje.' }, -360, 'Notificar gestora');
  // Ramo NÃO
  y = ySim;
  no('nao_remarcar', 'acao.atualizar_entrevista', { acao: 'solicitar_remarcacao' }, 0, 'Marcar "pediu outra data"');
  no('nao_datas', 'acao.consultar_disponibilidade', { dias: 30 }, 0, 'Consultar datas disponíveis da unidade');
  no('nao_pedir', 'acao.whatsapp_mensagem', { texto: 'Sem problemas! Temos outras datas disponíveis. Entre os dias {periodo_inicio} e {periodo_fim}, qual seria o melhor dia para você?', seFechada: 'portal' }, 0, 'Solicitar outra data');
  no('nao_espera', 'tempo.aguardar_resposta', { prazoHoras: 24, canal: 'qualquer' }, 0);
  no('nao_data', 'condicao.data', { dias: 30 }, 0, 'Validar a data escolhida');
  no('nao_livre', 'condicao.disponibilidade', {}, 0);
  no('nao_agendar', 'acao.agendar_entrevista', {}, 0, 'Atualizar agendamento');
  no('nao_confirmar', 'acao.enviar_confirmacao', {}, 0, 'Gerar nova confirmação');
  no('nao_avisar', 'acao.notificar_gestora', { titulo: 'Entrevista remarcada pelo candidato', texto: '{nome} escolheu outra data: {data_entrevista}, às {horario_entrevista}.' }, 0);
  // Data inválida ou sem horário: pede de novo (até 2 vezes) e depois chama a equipe.
  y = ySim + 140 * 5;
  no('outra_msg', 'acao.whatsapp_mensagem', { texto: 'Não encontrei horário livre nessa data. Pode sugerir outro dia entre {periodo_inicio} e {periodo_fim}?', seFechada: 'portal' }, 360, 'Pedir outra data');
  no('outra_repetir', 'tempo.repetir', { alvo: 'nao_espera', limite: 2 }, 360);
  no('outra_avisar', 'acao.notificar_gestora', { titulo: 'Remarcação precisa de ajuda', texto: '{nome} não conseguiu escolher uma data com horário livre.' }, 360);
  y = ySim;
  no('duvida', 'acao.notificar_gestora', { titulo: 'Resposta não entendida', texto: '{nome} respondeu algo que não é SIM nem NÃO. Veja a conversa.' }, 720);
  no('sem_resposta', 'acao.notificar_gestora', { titulo: 'Sem resposta', texto: '{nome} não respondeu à confirmação da entrevista.' }, 1080);
  no('sem_datas', 'acao.notificar_gestora', { titulo: 'Sem datas para remarcar', texto: 'Não há horários livres para remarcar a entrevista de {nome}.' }, 1440);

  liga('gatilho', 'proximo', 'codigo');
  liga('codigo', 'proximo', 'link');
  liga('link', 'proximo', 'pergunta');
  liga('pergunta', 'proximo', 'espera');
  liga('espera', 'respondeu', 'confirmou');
  liga('espera', 'tempo_esgotado', 'sem_resposta');
  liga('confirmou', 'sim', 'sim_confirmar');
  liga('sim_confirmar', 'proximo', 'sim_status');
  liga('sim_status', 'proximo', 'sim_tag');
  liga('sim_tag', 'proximo', 'sim_avisar');
  liga('confirmou', 'nao', 'nao_remarcar');
  liga('confirmou', 'outro', 'duvida');
  liga('nao_remarcar', 'proximo', 'nao_datas');
  liga('nao_datas', 'sim', 'nao_pedir');
  liga('nao_datas', 'nao', 'sem_datas');
  liga('nao_pedir', 'proximo', 'nao_espera');
  liga('nao_espera', 'respondeu', 'nao_data');
  liga('nao_espera', 'tempo_esgotado', 'sem_resposta');
  liga('nao_data', 'sim', 'nao_livre');
  liga('nao_data', 'nao', 'outra_msg');
  liga('nao_livre', 'sim', 'nao_agendar');
  liga('nao_livre', 'nao', 'outra_msg');
  liga('nao_agendar', 'proximo', 'nao_confirmar');
  liga('nao_agendar', 'indisponivel', 'outra_msg');
  liga('nao_confirmar', 'proximo', 'nao_avisar');
  liga('outra_msg', 'proximo', 'outra_repetir');
  liga('outra_repetir', 'esgotou', 'outra_avisar');
  return organizar({ nos, ligacoes });
}
