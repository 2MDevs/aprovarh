/**
 * Efeitos reais dos cards: usam os mesmos serviços das telas (status, tags, portal, entrevistas, WhatsApp),
 * dentro da transação do passo. Se o passo falhar, nada fica pela metade. Os envios pelo WhatsApp usam
 * uma chave de idempotência por execução e passo: reprocessar nunca manda de novo o que já foi enviado.
 */
import type { PoolClient } from 'pg';
import { auditar, type Ator } from '../../core/audit.ts';
import { publicar } from '../../core/tempoReal.ts';
import { env } from '../../config/env.ts';
import { encrypt } from '../../lib/crypto.ts';
import { dataPorExtenso, partesEmBrasilia } from '../../lib/datas.ts';
import { HttpError } from '../../lib/http.ts';
import { alterarStatusCandidato, alterarTagCandidato, type AutorMudanca } from '../central/service.ts';
import { agendar, horariosDaUnidade, mudarSituacao, remarcar, type Origem } from '../entrevistas/servico.ts';
import { liberarAcesso, revogarAcesso, type OrigemLiberacao } from '../portal/servico.ts';
import { notificarGestoras } from '../publico/service.ts';
import { configWhatsapp } from '../whatsapp/cliente.ts';
import { enfileirar, janelaAberta } from '../whatsapp/envio.ts';
import { ErroPasso, type CandidatoAtual, type Efeitos } from './cards.ts';

export interface InfoExecucao { id: string; numero: number; automacaoNome: string; passo: number }

export const linkDoPortal = () => `${env.APP_URL.replace(/\/$/, '')}/acesso`;

/** Roda um trecho que pode recusar (regra de negócio) sem estragar a transação do passo. */
async function comSavepoint<T>(db: PoolClient, fn: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; erro: HttpError }> {
  await db.query('SAVEPOINT efeito');
  try {
    const valor = await fn();
    await db.query('RELEASE SAVEPOINT efeito');
    return { ok: true, valor };
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT efeito');
    if (err instanceof HttpError && err.status < 500) return { ok: false, erro: err };
    throw err;
  }
}

/** Erro de regra de negócio vira erro definitivo do passo (não adianta tentar de novo). */
async function definitivo<T>(db: PoolClient, fn: () => Promise<T>): Promise<T> {
  const r = await comSavepoint(db, fn);
  if (!r.ok) throw new ErroPasso(r.erro.message);
  return r.valor;
}

export function efeitosReais(db: PoolClient, cand: CandidatoAtual, ex: InfoExecucao): Efeitos {
  const nome = `Automação: ${ex.automacaoNome} (execução nº ${ex.numero})`;
  const ator: Ator = { usuarioNome: nome, perfil: 'Automação' };
  const autor: AutorMudanca = { tipo: 'automacao', id: ex.id, nome };
  const origem: Origem = { tipo: 'automacao', nome, ator };
  const origemPortal: OrigemLiberacao = { tipo: 'automacao', execucaoId: ex.id, ator };
  const chave = (sufixo: string) => `auto:${ex.id}:${ex.passo}:${sufixo}`;
  const robo = { tipo: 'chatbot' as const, nome: 'Assistente virtual' };
  const item = { tipo: 'candidato', id: cand.id };

  const chat = async (texto: string) => {
    const r = await db.query<{ id: string; criado_em: Date; conversa_id: string }>(
      `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, execucao_id, texto, visivel_ao_candidato, situacao_entrega)
       SELECT id, 'saida', 'portal', 'chatbot', 'Assistente virtual', $2, $3, true, 'enviada' FROM conversas WHERE candidato_id = $1
       RETURNING id, criado_em, conversa_id`,
      [cand.id, ex.id, encrypt(texto)],
    );
    if (!r.rows[0]) throw new ErroPasso('Conversa do candidato não encontrada.');
    await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE id = $1', [r.rows[0].conversa_id, r.rows[0].id, r.rows[0].criado_em]);
    await db.query('INSERT INTO eventos_dominio (tipo, candidato_id, dados) VALUES ($1, $2, $3)', ['mensagem.enviada', cand.id, JSON.stringify({ mensagemId: r.rows[0].id, canal: 'portal', autor: 'chatbot', execucaoId: ex.id })]);
    await auditar({ acao: 'mensagem.enviada', resultado: 'sucesso', item, detalhes: { canal: 'portal', execucaoId: ex.id }, ator }, db);
    await publicar(db, { tipo: 'mensagem.nova', candidatoId: cand.id, unidadeId: cand.unidadeId });
  };

  return {
    modo: 'real',

    async whatsappTexto(texto, seFechada) {
      const { provedor } = await configWhatsapp();
      if (provedor === 'meta' && !(await janelaAberta(db, cand.id))) {
        if (seFechada === 'falhar') throw new ErroPasso('Janela de 24 h da Meta fechada: o candidato não escreveu nas últimas 24 h.');
        await chat(texto);
        return 'portal';
      }
      await definitivo(db, () => enfileirar(db, { candidatoId: cand.id, conteudo: { tipo: 'texto', texto }, autor: robo, chaveIdempotencia: chave('texto'), execucaoId: ex.id }));
      await auditar({ acao: 'mensagem.enviada', resultado: 'sucesso', item, detalhes: { canal: 'whatsapp', execucaoId: ex.id }, ator }, db);
      return 'whatsapp';
    },

    chat,

    async gerarCodigo(permiteArquivo) {
      const r = await definitivo(db, () => liberarAcesso(db, cand.id, cand.unidadeId, origemPortal, { permiteArquivo }));
      cand.acessoAtivo = true;
      return r.codigo;
    },

    async enviarCodigo(codigo) {
      const link = linkDoPortal();
      await definitivo(db, () => enfileirar(db, {
        candidatoId: cand.id, conteudo: { tipo: 'aviso', finalidade: 'codigo', variaveis: { nome: cand.nome, codigo, link } }, autor: robo,
        chaveIdempotencia: chave('codigo'), execucaoId: ex.id,
        textoNaConversa: `Código de acesso ao portal enviado (válido até 23h59 de hoje): ••••-••••. Link: ${link}`,
      }));
    },

    async revogar() {
      const r = await revogarAcesso(db, cand.id, cand.unidadeId, origemPortal, 'Revogado pela automação');
      cand.acessoAtivo = false;
      return r;
    },

    async alterarStatus(statusId) {
      const r = await definitivo(db, () => alterarStatusCandidato(db, cand.id, statusId, autor, null));
      if (!r) return false;
      await auditar({ acao: 'candidato.status_alterado', resultado: 'sucesso', item: { ...item, nome: r.codigo }, detalhes: { de: r.de, para: r.para, execucaoId: ex.id }, ator }, db);
      cand.statusId = statusId;
      return true;
    },

    async tag(tagId, acao) {
      const r = await definitivo(db, () => alterarTagCandidato(db, cand.id, tagId, acao, autor));
      if (!r) return false;
      await auditar({ acao: acao === 'adicionar' ? 'candidato.tag_adicionada' : 'candidato.tag_removida', resultado: 'sucesso', item: { ...item, nome: r.codigo }, detalhes: { tag: r.tag, execucaoId: ex.id }, ator }, db);
      return true;
    },

    async entrevista(acao) {
      if (!cand.entrevista) throw new ErroPasso('O candidato não tem entrevista marcada.');
      const alvo = { confirmar: 'confirmada', solicitar_remarcacao: 'remarcacao_solicitada', cancelar: 'cancelada', realizada: 'realizada', nao_compareceu: 'nao_compareceu' }[acao];
      if (cand.entrevista.situacao === alvo) return false;
      await definitivo(db, () => mudarSituacao(db, cand.entrevista!.id, acao, origem, 'Pela automação'));
      return true;
    },

    async agendar(inicio) {
      const aberta = cand.entrevista;
      const r = await comSavepoint(db, () => (aberta
        ? remarcar(db, aberta.id, inicio, origem, 'Data escolhida pelo candidato')
        : agendar(db, cand.id, inicio, origem)));
      if (!r.ok) return 'indisponivel'; // sem vaga ou fora da disponibilidade: nunca marca à força
      return aberta ? 'remarcada' : 'agendada';
    },

    async enviarConfirmacao() {
      const e = cand.entrevista;
      if (!e) throw new ErroPasso('O candidato não tem entrevista marcada.');
      const inicio = new Date(e.inicioEm);
      await definitivo(db, () => enfileirar(db, {
        candidatoId: cand.id, conteudo: { tipo: 'aviso', finalidade: 'entrevista', variaveis: { data: dataPorExtenso(inicio), horario: partesEmBrasilia(inicio).hora } },
        autor: robo, chaveIdempotencia: chave(`confirmacao:${e.id}`), execucaoId: ex.id,
      }));
    },

    async registrarResposta(texto) {
      if (cand.entrevista) {
        await db.query(
          `INSERT INTO entrevista_eventos (entrevista_id, tipo, resposta_original, autor_tipo, autor_nome) VALUES ($1, 'resposta', $2, 'automacao', $3)`,
          [cand.entrevista.id, encrypt(texto), nome],
        );
        return;
      }
      await db.query(
        `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, execucao_id, texto, visivel_ao_candidato)
         SELECT id, 'entrada', 'sistema', 'sistema', 'Sistema', $2, $3, false FROM conversas WHERE candidato_id = $1`,
        [cand.id, ex.id, encrypt(`Resposta registrada pela automação: "${texto}"`)],
      );
    },

    async notificar(titulo, texto) {
      await notificarGestoras(db, cand.unidadeId, titulo.slice(0, 120), texto.slice(0, 500), `/conversas?c=${cand.id}`);
    },

    async horarios(de, ate) {
      return horariosDaUnidade(db, cand.unidadeId, de, ate, cand.entrevista?.id);
    },
    nomeStatus: (id) => nomeDe(db, 'status', id),
    nomeTag: (id) => nomeDe(db, 'tags', id),
    async mensagensRecebidas(canal, desde) {
      const r = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM mensagens m JOIN conversas cv ON cv.id = m.conversa_id JOIN candidatos c ON c.id = cv.candidato_id
          WHERE cv.candidato_id = $1 AND m.sentido = 'entrada' AND m.autor_tipo = 'candidato'
            AND ($2::text = 'qualquer' OR m.canal = $2::text) AND ($3::text = 'sempre' OR m.criado_em >= c.candidatura_em)`,
        [cand.id, canal, desde],
      );
      return r.rows[0]?.n ?? 0;
    },
  };
}

export async function nomeDe(db: PoolClient | { query: PoolClient['query'] }, tabela: 'status' | 'tags', id: string): Promise<string> {
  const r = await db.query<{ nome: string }>(`SELECT nome FROM ${tabela} WHERE id = $1`, [id]);
  return r.rows[0]?.nome ?? '(removido)';
}

/** Situação atual do candidato, lida a cada passo (nunca de cache). */
export async function carregarCandidato(db: PoolClient | { query: PoolClient['query'] }, id: string): Promise<CandidatoAtual | null> {
  const r = await db.query<{ id: string; nome: string; unidade_id: string; unidade_nome: string; status_id: string; tags: string[] | null; ent_id: string | null; ent_situacao: string | null; ent_inicio: Date | null; acesso: boolean }>(
    `SELECT c.id, c.nome, c.unidade_id, u.nome AS unidade_nome, c.status_id,
            (SELECT array_agg(tag_id) FROM candidato_tags WHERE candidato_id = c.id) AS tags,
            e.id AS ent_id, e.situacao AS ent_situacao, e.inicio_em AS ent_inicio,
            EXISTS (SELECT 1 FROM liberacoes_acesso l WHERE l.candidato_id = c.id AND l.situacao = 'ativa' AND l.expira_em > now()) AS acesso
       FROM candidatos c JOIN unidades u ON u.id = c.unidade_id
       LEFT JOIN entrevistas e ON e.candidato_id = c.id AND e.situacao IN ('aguardando_confirmacao', 'confirmada', 'remarcacao_solicitada')
      WHERE c.id = $1 AND c.excluido_em IS NULL`,
    [id],
  );
  const c = r.rows[0];
  if (!c) return null;
  return {
    id: c.id, nome: c.nome.split(' ')[0], unidadeId: c.unidade_id, unidadeNome: c.unidade_nome, statusId: c.status_id, tagIds: c.tags ?? [],
    entrevista: c.ent_id ? { id: c.ent_id, situacao: c.ent_situacao!, inicioEm: new Date(c.ent_inicio!).toISOString() } : null,
    acessoAtivo: c.acesso,
  };
}
