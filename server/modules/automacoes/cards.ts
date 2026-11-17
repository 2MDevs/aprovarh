/**
 * O que cada card faz. Este arquivo não fala com o banco: tudo o que mexe em dados passa pela
 * interface `Efeitos`, que tem duas versões — a real (efeitos.ts) e a de teste (só registra o que faria).
 * Assim o modo de teste roda exatamente o mesmo código do motor, sem enviar nada.
 */
import { CARD, LIMITES, param, proximoNo, gatilhoDo, type Fluxo, type No } from '../../../shared/automacoes.ts';
import { dataPorExtenso, instanteEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { interpretarData, interpretarSimNao, normalizarTexto } from '../../lib/interpretar.ts';

export interface CandidatoAtual {
  id: string;
  nome: string; // primeiro nome
  unidadeId: string;
  unidadeNome: string;
  statusId: string;
  tagIds: string[];
  entrevista: { id: string; situacao: string; inicioEm: string } | null;
  acessoAtivo: boolean;
}

export interface Contexto {
  evento: { tipo: string; dados: Record<string, unknown> };
  resposta?: { texto: string; canal: string } | null;
  dataProposta?: { data: string; hora: string | null } | null;
  horario?: string | null;
  periodo?: { de: string; ate: string } | null;
  /** Existe só entre "Gerar código" e "Enviar link" (o contexto todo fica cifrado no banco). */
  codigo?: string | null;
  repeticoes?: Record<string, number>;
  /** Card que pediu para continuar nele mesmo depois de uma espera (ex.: "Expirar autorização"). */
  retomando?: string | null;
}

export type Espera =
  | { tipo: 'tempo'; ate: Date; saida: string }
  | { tipo: 'resposta'; prazo: Date; canal: string };

export interface Resultado {
  saida?: string;
  resumo: string;
  patch?: Partial<Contexto>;
  esperar?: Espera;
  /** Pula para outro card (só o "Repetir tentativa"). */
  irPara?: string;
}

/** Saída especial: depois da espera, volta a executar o mesmo card. */
export const RETOMAR = '__retomar';

export interface HorarioLivre { inicioEm: string; data: string; hora: string; livres: number }

export interface Efeitos {
  modo: 'real' | 'teste';
  whatsappTexto(texto: string, seFechada: 'portal' | 'falhar'): Promise<'whatsapp' | 'portal'>;
  chat(texto: string): Promise<void>;
  gerarCodigo(permiteArquivo: boolean): Promise<string>;
  enviarCodigo(codigo: string): Promise<void>;
  revogar(): Promise<boolean>;
  alterarStatus(statusId: string): Promise<boolean>;
  tag(tagId: string, acao: 'adicionar' | 'remover'): Promise<boolean>;
  entrevista(acao: 'confirmar' | 'solicitar_remarcacao' | 'cancelar' | 'realizada' | 'nao_compareceu'): Promise<boolean>;
  agendar(inicio: Date): Promise<'agendada' | 'remarcada' | 'indisponivel'>;
  enviarConfirmacao(): Promise<void>;
  registrarResposta(texto: string): Promise<void>;
  notificar(titulo: string, texto: string): Promise<void>;
  /** Somente leitura (vale também no teste). */
  horarios(de: string, ate: string): Promise<HorarioLivre[]>;
  nomeStatus(id: string): Promise<string>;
  nomeTag(id: string): Promise<string>;
  /** Quantas mensagens o candidato escreveu (somente leitura). */
  mensagensRecebidas(canal: string, desde: 'candidatura' | 'sempre'): Promise<number>;
}

export interface Config { sim: string[]; nao: string[]; link: string; agora: Date }

/** Erro de um passo. Temporário = vale tentar de novo (conexão, banco ocupado). */
export class ErroPasso extends Error {
  constructor(message: string, public temporario = false) {
    super(message);
  }
}

const br = (data: string) => data.split('-').reverse().slice(0, 2).join('/');
const somarDias = (data: string, dias: number) => new Date(Date.parse(`${data}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** Troca {nome}, {unidade}, {data_entrevista}... no texto. */
export function renderizar(texto: string, ctx: Contexto, cand: CandidatoAtual, cfg: Config): string {
  const ent = cand.entrevista ? new Date(cand.entrevista.inicioEm) : null;
  const valores: Record<string, string> = {
    nome: cand.nome,
    unidade: cand.unidadeNome,
    data_entrevista: ent ? dataPorExtenso(ent) : '(sem entrevista)',
    horario_entrevista: ent ? partesEmBrasilia(ent).hora : '(sem entrevista)',
    periodo_inicio: ctx.periodo ? br(ctx.periodo.de) : '',
    periodo_fim: ctx.periodo ? br(ctx.periodo.ate) : '',
    link: cfg.link,
  };
  return texto.replace(/\{([a-z_]+)\}/g, (m, v: string) => valores[v] ?? m);
}

/** Próximo instante com o horário HH:MM (hoje, se ainda não passou; senão amanhã). */
function proximoHorario(agora: Date, hora: string, dias?: number[]): Date {
  const hoje = partesEmBrasilia(agora).data;
  for (let i = 0; i < 8; i++) {
    const data = somarDias(hoje, i);
    const quando = instanteEmBrasilia(data, hora);
    const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
    if (quando > agora && (!dias || dias.includes(diaSemana))) return quando;
  }
  return instanteEmBrasilia(somarDias(hoje, 1), hora);
}

export async function executarCard(no: No, ctx: Contexto, cand: CandidatoAtual, ef: Efeitos, cfg: Config): Promise<Resultado> {
  const def = CARD[no.tipo];
  if (!def) throw new ErroPasso(`Card desconhecido: ${no.tipo}`);
  const p = <T = unknown>(chave: string) => param<T>(no, chave);
  const hoje = partesEmBrasilia(cfg.agora).data;
  const resposta = ctx.resposta?.texto ?? '';
  const semEntrevista = () => new ErroPasso('O candidato não tem entrevista marcada.');

  if (def.categoria === 'gatilho') return { saida: 'proximo', resumo: `Disparado: ${def.nome.toLowerCase()}.` };

  switch (no.tipo) {
    // ── Condições ──
    case 'condicao.se': {
      const campo = p<string>('campo');
      const valor = String(p('valor') ?? '');
      let ok = false;
      if (campo === 'resposta_contem') ok = normalizarTexto(resposta).includes(normalizarTexto(valor));
      if (campo === 'antes_de') ok = partesEmBrasilia(cfg.agora).hora < valor;
      if (campo === 'dia_semana') ok = [1, 2, 3, 4, 5].includes(partesEmBrasilia(cfg.agora).diaSemana);
      if (campo === 'tem_entrevista') ok = Boolean(cand.entrevista);
      return { saida: ok ? 'sim' : 'nao', resumo: ok ? 'Condição verdadeira.' : 'Condição falsa.' };
    }
    case 'condicao.resposta_sim_nao': {
      const r = interpretarSimNao(resposta, cfg.sim, cfg.nao);
      return { saida: r === 'ambiguo' ? 'outro' : r, resumo: r === 'sim' ? 'Resposta: SIM.' : r === 'nao' ? 'Resposta: NÃO.' : 'Resposta não entendida.' };
    }
    case 'condicao.unidade': {
      const ok = (p<string[]>('unidades') ?? []).includes(cand.unidadeId);
      return { saida: ok ? 'sim' : 'nao', resumo: `Unidade ${cand.unidadeNome}${ok ? '' : ' não'} está na lista.` };
    }
    case 'condicao.status': {
      const ok = (p<string[]>('status') ?? []).includes(cand.statusId);
      return { saida: ok ? 'sim' : 'nao', resumo: `Status "${await ef.nomeStatus(cand.statusId)}"${ok ? '' : ' não'} está na lista.` };
    }
    case 'condicao.enviou_mensagem': {
      const canal = p<string>('canal') ?? 'qualquer';
      const n = await ef.mensagensRecebidas(canal, p<string>('desde') === 'sempre' ? 'sempre' : 'candidatura');
      const onde = canal === 'whatsapp' ? ' pelo WhatsApp' : canal === 'portal' ? ' pelo portal' : '';
      return { saida: n > 0 ? 'sim' : 'nao', resumo: n > 0 ? `O candidato já enviou ${n} mensagem(ns)${onde}.` : `O candidato ainda não enviou mensagem${onde}.` };
    }
    case 'condicao.tag': {
      const tag = p<string>('tag');
      const ok = cand.tagIds.includes(tag);
      return { saida: ok ? 'sim' : 'nao', resumo: `${ok ? 'Tem' : 'Não tem'} a tag "${await ef.nomeTag(tag)}".` };
    }
    case 'condicao.data': {
      const ate = somarDias(hoje, Number(p('dias')));
      const r = interpretarData(resposta, hoje, hoje, ate);
      if (r.tipo === 'data' && r.datas.length === 1) {
        return { saida: 'sim', resumo: `Data entendida: ${br(r.datas[0])}${r.hora ? ` às ${r.hora}` : ''}.`, patch: { dataProposta: { data: r.datas[0], hora: r.hora } } };
      }
      return { saida: 'nao', resumo: r.tipo === 'ambiguo' ? `Data não entendida (${r.motivo}).` : 'A resposta tem mais de uma data possível.', patch: { dataProposta: null } };
    }
    case 'condicao.disponibilidade': {
      const d = ctx.dataProposta;
      if (!d) throw new ErroPasso('Falta a data informada pelo candidato.');
      const livres = (await ef.horarios(d.data, d.data)).filter((h) => h.livres > 0);
      const escolhido = d.hora ? livres.find((h) => h.hora === d.hora) : livres[0];
      if (escolhido) return { saida: 'sim', resumo: `Horário livre: ${br(escolhido.data)} às ${escolhido.hora}.`, patch: { horario: escolhido.inicioEm } };
      return { saida: 'nao', resumo: livres.length ? `Não há vaga às ${d.hora} em ${br(d.data)}.` : `Sem horários livres em ${br(d.data)}.`, patch: { horario: null } };
    }
    case 'condicao.codigo_valido':
      return { saida: cand.acessoAtivo ? 'sim' : 'nao', resumo: cand.acessoAtivo ? 'Acesso ao portal liberado.' : 'Sem acesso liberado.' };
    case 'condicao.entrevista_confirmada': {
      const ok = cand.entrevista?.situacao === 'confirmada';
      return { saida: ok ? 'sim' : 'nao', resumo: ok ? 'Entrevista confirmada.' : cand.entrevista ? 'Entrevista ainda não confirmada.' : 'Sem entrevista marcada.' };
    }

    // ── Ações ──
    case 'acao.whatsapp_mensagem': {
      const canal = await ef.whatsappTexto(renderizar(String(p('texto')), ctx, cand, cfg), p<'portal' | 'falhar'>('seFechada'));
      return { saida: 'proximo', resumo: canal === 'whatsapp' ? 'Mensagem enviada pelo WhatsApp.' : 'Janela da Meta fechada: mensagem enviada pelo chat do portal.' };
    }
    case 'acao.chat_mensagem':
      await ef.chat(renderizar(String(p('texto')), ctx, cand, cfg));
      return { saida: 'proximo', resumo: 'Mensagem enviada pelo chat do portal.' };
    case 'acao.gerar_codigo': {
      const codigo = await ef.gerarCodigo(Boolean(p('permiteArquivo')));
      return { saida: 'proximo', resumo: 'Código gerado (vale até 23h59 de hoje).', patch: { codigo } };
    }
    case 'acao.enviar_link': {
      if (!ctx.codigo) throw new ErroPasso('Não há código para enviar. Coloque "Gerar código de acesso" antes.');
      await ef.enviarCodigo(ctx.codigo);
      return { saida: 'proximo', resumo: 'Link e código enviados pelo WhatsApp.', patch: { codigo: null } };
    }
    case 'acao.liberar_acesso': {
      const codigo = await ef.gerarCodigo(Boolean(p('permiteArquivo')));
      await ef.enviarCodigo(codigo);
      return { saida: 'proximo', resumo: 'Acesso liberado e link enviado pelo WhatsApp.' };
    }
    case 'acao.revogar_acesso':
      return { saida: 'proximo', resumo: (await ef.revogar()) ? 'Acesso revogado.' : 'Não havia acesso liberado.' };
    case 'acao.alterar_status': {
      const id = p<string>('status');
      const mudou = await ef.alterarStatus(id);
      return { saida: 'proximo', resumo: `${mudou ? 'Status alterado para' : 'Já estava no status'} "${await ef.nomeStatus(id)}".` };
    }
    case 'acao.adicionar_tag': case 'acao.remover_tag': {
      const id = p<string>('tag');
      const acao = no.tipo === 'acao.adicionar_tag' ? 'adicionar' : 'remover';
      const mudou = await ef.tag(id, acao);
      return { saida: 'proximo', resumo: `Tag "${await ef.nomeTag(id)}" ${mudou ? (acao === 'adicionar' ? 'adicionada' : 'removida') : (acao === 'adicionar' ? 'já estava' : 'não estava')}.` };
    }
    case 'acao.consultar_disponibilidade': {
      const livres = (await ef.horarios(hoje, somarDias(hoje, Number(p('dias'))))).filter((h) => h.livres > 0);
      if (!livres.length) return { saida: 'nao', resumo: 'Nenhum horário livre no período.', patch: { periodo: null } };
      const periodo = { de: livres[0].data, ate: livres[livres.length - 1].data };
      return { saida: 'sim', resumo: `Horários livres entre ${br(periodo.de)} e ${br(periodo.ate)}.`, patch: { periodo } };
    }
    case 'acao.agendar_entrevista': {
      if (!ctx.horario) throw new ErroPasso('Falta o horário escolhido. Coloque "Verificar disponibilidade" antes.');
      const r = await ef.agendar(new Date(ctx.horario));
      if (r === 'indisponivel') return { saida: 'indisponivel', resumo: 'O horário foi ocupado antes de agendar.' };
      const quando = partesEmBrasilia(new Date(ctx.horario));
      return { saida: 'proximo', resumo: `Entrevista ${r} para ${br(quando.data)} às ${quando.hora}.` };
    }
    case 'acao.enviar_confirmacao':
      if (!cand.entrevista) throw semEntrevista();
      await ef.enviarConfirmacao();
      return { saida: 'proximo', resumo: 'Pedido de confirmação (SIM ou NÃO) enviado pelo WhatsApp.' };
    case 'acao.atualizar_entrevista': {
      if (!cand.entrevista) throw semEntrevista();
      const acao = p<'confirmar' | 'solicitar_remarcacao' | 'cancelar' | 'realizada' | 'nao_compareceu'>('acao');
      const rotulo = def.parametros[0].opcoes!.find((o) => o.valor === acao)?.rotulo ?? acao;
      const mudou = await ef.entrevista(acao);
      return { saida: 'proximo', resumo: mudou ? `Entrevista: ${rotulo.toLowerCase()}.` : `Entrevista já estava assim (${rotulo.toLowerCase()}).` };
    }
    case 'acao.registrar_resposta':
      await ef.registrarResposta(resposta);
      return { saida: 'proximo', resumo: 'Resposta registrada no histórico.' };
    case 'acao.notificar_gestora':
      await ef.notificar(String(p('titulo')), renderizar(String(p('texto')), ctx, cand, cfg));
      return { saida: 'proximo', resumo: 'Gestora notificada.' };

    // ── Tempo ──
    case 'tempo.aguardar_periodo': {
      const q = Number(p('quantidade'));
      const unidade = p<string>('unidade');
      const ms = q * (unidade === 'minutos' ? 60_000 : unidade === 'dias' ? 86_400_000 : 3_600_000);
      return { resumo: `Aguardando ${q} ${unidade}.`, esperar: { tipo: 'tempo', ate: new Date(cfg.agora.getTime() + ms), saida: 'proximo' } };
    }
    case 'tempo.aguardar_data': {
      let ate: Date;
      if (p('referencia') === 'entrevista') {
        if (!cand.entrevista) throw semEntrevista();
        ate = new Date(new Date(cand.entrevista.inicioEm).getTime() - Number(p('horasAntes')) * 3_600_000);
      } else {
        ate = instanteEmBrasilia(String(p('data')), String(p('hora')));
      }
      if (ate <= cfg.agora) return { saida: 'proximo', resumo: 'A data já passou: seguiu direto.' };
      const q = partesEmBrasilia(ate);
      return { resumo: `Aguardando até ${br(q.data)} às ${q.hora}.`, esperar: { tipo: 'tempo', ate, saida: 'proximo' } };
    }
    case 'tempo.aguardar_horario': {
      const ate = proximoHorario(cfg.agora, String(p('hora')));
      return { resumo: `Aguardando até ${br(partesEmBrasilia(ate).data)} às ${p('hora')}.`, esperar: { tipo: 'tempo', ate, saida: 'proximo' } };
    }
    case 'tempo.executar_em_dia': {
      const ate = proximoHorario(cfg.agora, String(p('hora')), (p<number[]>('dias') ?? []).map(Number));
      return { resumo: `Aguardando até ${br(partesEmBrasilia(ate).data)} às ${p('hora')}.`, esperar: { tipo: 'tempo', ate, saida: 'proximo' } };
    }
    case 'tempo.aguardar_resposta': {
      const qtd = Number(p('prazoHoras'));
      const minutos = p<string>('unidadePrazo') === 'minutos';
      return {
        resumo: `Aguardando resposta por até ${qtd} ${minutos ? 'min' : 'h'}.`,
        esperar: { tipo: 'resposta', prazo: new Date(cfg.agora.getTime() + qtd * (minutos ? 60_000 : 3_600_000)), canal: p<string>('canal') ?? 'qualquer' },
        patch: { resposta: null },
      };
    }
    case 'tempo.expirar_autorizacao': {
      if (ctx.retomando === no.id) {
        const revogou = await ef.revogar();
        return { saida: 'proximo', resumo: revogou ? 'Prazo encerrado: acesso revogado.' : 'Prazo encerrado: não havia acesso liberado.', patch: { retomando: null } };
      }
      const horas = Number(p('horas'));
      return { resumo: `Acesso será revogado em ${horas} h.`, esperar: { tipo: 'tempo', ate: new Date(cfg.agora.getTime() + horas * 3_600_000), saida: RETOMAR } };
    }
    case 'tempo.repetir': {
      const limite = Number(p('limite'));
      const feitas = ctx.repeticoes?.[no.id] ?? 0;
      if (feitas >= limite) return { saida: 'esgotou', resumo: `Limite de ${limite} repetição(ões) atingido.` };
      return { irPara: String(p('alvo')), resumo: `Repetindo (${feitas + 1} de ${limite}).`, patch: { repeticoes: { ...ctx.repeticoes, [no.id]: feitas + 1 } } };
    }
  }
  throw new ErroPasso(`O card "${def.nome}" ainda não tem execução.`);
}

/** Junta o resultado no contexto (null apaga o campo). */
export function aplicarPatch(ctx: Contexto, patch?: Partial<Contexto>): Contexto {
  if (!patch) return ctx;
  const novo = { ...ctx } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete novo[k];
    else novo[k] = v;
  }
  return novo as unknown as Contexto;
}

/** Para onde ir depois do resultado (null = fim). */
export function destino(f: Fluxo, no: No, r: Resultado, saida = r.saida): No | null {
  if (r.irPara) return f.nos.find((n) => n.id === r.irPara) ?? null;
  if (saida === RETOMAR) return no;
  return saida ? proximoNo(f, no.id, saida) : null;
}

// ── Modo de teste ─────────────────────────────────────────────────────────
export interface PassoSimulado { noId: string; nome: string; categoria: string; saida: string | null; resumo: string; erro?: boolean }

/**
 * Percorre o fluxo com dados simulados. Esperas não esperam: "Aguardar resposta" usa a próxima
 * resposta simulada (ou segue por "Tempo esgotado" se não houver), e as esperas de tempo seguem direto.
 */
export async function simular(f: Fluxo, cand: CandidatoAtual, ctx0: Contexto, ef: Efeitos, cfg: Config, respostas: string[]): Promise<{ passos: PassoSimulado[]; fim: string }> {
  const passos: PassoSimulado[] = [];
  const fila = [...respostas];
  let ctx = ctx0;
  let no = gatilhoDo(f);
  if (!no) return { passos, fim: 'O fluxo não tem gatilho.' };
  const def0 = CARD[no.tipo];
  if (def0?.produz?.includes('resposta')) {
    const r = fila.shift();
    if (r !== undefined) ctx = aplicarPatch(ctx, { resposta: { texto: r, canal: 'whatsapp' } });
  }
  while (no) {
    if (passos.length >= LIMITES.passosPorExecucao) return { passos, fim: `Parou no limite de ${LIMITES.passosPorExecucao} passos.` };
    const def = CARD[no.tipo];
    const base = { noId: no.id, nome: no.nome || def?.nome || no.tipo, categoria: def?.categoria ?? '' };
    let r: Resultado;
    try {
      r = await executarCard(no, ctx, cand, ef, cfg);
    } catch (err) {
      passos.push({ ...base, saida: null, resumo: (err as Error).message, erro: true });
      return { passos, fim: 'Parou com erro: na execução real, o passo seria tentado de novo e depois marcado "Com erro".' };
    }
    ctx = aplicarPatch(ctx, r.patch);
    let saida = r.saida ?? null;
    let resumo = r.resumo;
    if (r.esperar?.tipo === 'tempo') {
      saida = r.esperar.saida;
      resumo += ' (no teste, segue direto)';
      if (saida === RETOMAR) ctx = aplicarPatch(ctx, { retomando: no.id });
    } else if (r.esperar?.tipo === 'resposta') {
      const resp = fila.shift();
      if (resp !== undefined && resp !== '') {
        ctx = aplicarPatch(ctx, { resposta: { texto: resp, canal: 'whatsapp' } });
        saida = 'respondeu';
        resumo += ` Resposta simulada: "${resp}".`;
      } else {
        saida = 'tempo_esgotado';
        resumo += ' Sem resposta simulada: tempo esgotado.';
      }
    }
    passos.push({ ...base, saida: r.irPara ? `voltar para ${r.irPara}` : saida === RETOMAR ? 'retomar' : saida, resumo });
    no = destino(f, no, r, saida ?? undefined);
  }
  return { passos, fim: 'Fluxo concluído.' };
}

/**
 * Efeitos de teste: nada é enviado nem gravado. O candidato simulado muda na memória,
 * para as condições seguintes enxergarem o que teria acontecido.
 */
export function efeitosDeTeste(
  cand: CandidatoAtual,
  leitura: { horarios: Efeitos['horarios']; nomeStatus: Efeitos['nomeStatus']; nomeTag: Efeitos['nomeTag']; mensagensRecebidas?: Efeitos['mensagensRecebidas'] },
  opcoes: { janelaAberta: boolean; provedor: 'meta' | 'evolution' },
): Efeitos {
  return {
    modo: 'teste',
    // No teste não há candidato de verdade: conta como "ainda não escreveu" (as respostas simuladas vêm depois).
    mensagensRecebidas: async () => 0,
    ...leitura,
    async whatsappTexto(_texto, seFechada) {
      if (opcoes.provedor === 'meta' && !opcoes.janelaAberta) {
        if (seFechada === 'falhar') throw new ErroPasso('Janela de 24 h da Meta fechada.');
        return 'portal';
      }
      return 'whatsapp';
    },
    async chat() {},
    async gerarCodigo() {
      cand.acessoAtivo = true;
      return 'TEST-E000';
    },
    async enviarCodigo() {},
    async revogar() {
      const tinha = cand.acessoAtivo;
      cand.acessoAtivo = false;
      return tinha;
    },
    async alterarStatus(id) {
      if (cand.statusId === id) return false;
      cand.statusId = id;
      return true;
    },
    async tag(id, acao) {
      const tem = cand.tagIds.includes(id);
      if (acao === 'adicionar' && !tem) cand.tagIds.push(id);
      if (acao === 'remover' && tem) cand.tagIds = cand.tagIds.filter((t) => t !== id);
      return acao === 'adicionar' ? !tem : tem;
    },
    async entrevista(acao) {
      if (!cand.entrevista) return false;
      const para = { confirmar: 'confirmada', solicitar_remarcacao: 'remarcacao_solicitada', cancelar: 'cancelada', realizada: 'realizada', nao_compareceu: 'nao_compareceu' }[acao];
      if (cand.entrevista.situacao === para) return false;
      cand.entrevista = ['cancelada', 'realizada', 'nao_compareceu'].includes(para) ? null : { ...cand.entrevista, situacao: para };
      return true;
    },
    async agendar(inicio) {
      const livre = (await leitura.horarios(partesEmBrasilia(inicio).data, partesEmBrasilia(inicio).data)).some((h) => h.inicioEm === inicio.toISOString() && h.livres > 0);
      if (!livre) return 'indisponivel';
      const tinha = Boolean(cand.entrevista);
      cand.entrevista = { id: 'simulada', situacao: 'aguardando_confirmacao', inicioEm: inicio.toISOString() };
      return tinha ? 'remarcada' : 'agendada';
    },
    async enviarConfirmacao() {},
    async registrarResposta() {},
    async notificar() {},
  };
}
