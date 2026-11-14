import type { PoolClient } from 'pg';
import { cfg, cfgBooleano, cfgNumero } from '../../core/settings.ts';
import { encrypt } from '../../lib/crypto.ts';
import { dataPorExtenso, diaEmBrasilia, instanteEmBrasilia, partesEmBrasilia } from '../../lib/datas.ts';
import { interpretarData, interpretarSimNao, NAO_PADRAO, SIM_PADRAO } from '../../lib/interpretar.ts';
import { horariosDaUnidade, mudarSituacao, remarcar, type Horario, type Origem } from '../entrevistas/servico.ts';
import { notificarGestoras } from '../publico/service.ts';
import { enfileirar } from './envio.ts';

/**
 * Respostas automáticas da entrevista pelo WhatsApp (seção 8 do prompt):
 * - aguardando confirmação: SIM confirma; NÃO pede outra data e informa o período disponível;
 * - pediu outra data: lê a data (e o horário, se vier), confere disponibilidade e vaga, remarca e confirma;
 * - qualquer coisa não clara: pede esclarecimento. Nunca confirma data indisponível.
 * Tudo grava a resposta original. Desligável em Integração › WhatsApp ("Responder automaticamente").
 */
const lista = (v: string | null, padrao: string[]) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : padrao);
const br = (data: string) => data.split('-').reverse().slice(0, 2).join('/');
const descrever = (inicio: Date) => `${dataPorExtenso(inicio)}, às ${partesEmBrasilia(inicio).hora}`;

async function responder(db: PoolClient, candidatoId: string, texto: string, chave: string) {
  // A janela de 24 h está aberta (o candidato acabou de escrever), então texto livre é permitido também na Meta.
  await enfileirar(db, { candidatoId, conteudo: { tipo: 'texto', texto }, autor: { tipo: 'chatbot', nome: 'Assistente virtual' }, chaveIdempotencia: chave });
}

async function eventoEntrevista(db: PoolClient, entrevistaId: string, tipo: string, respostaOriginal: string, extra: { data?: Date | null; aceita?: boolean | null; motivo?: string | null } = {}) {
  await db.query(
    `INSERT INTO entrevista_eventos (entrevista_id, tipo, resposta_original, data_interpretada, aceita, motivo, autor_tipo, autor_nome)
     VALUES ($1, $2, $3, $4, $5, $6, 'candidato', 'Candidato (WhatsApp)')`,
    [entrevistaId, tipo, encrypt(respostaOriginal), extra.data ?? null, extra.aceita ?? null, extra.motivo ?? null],
  );
}

function periodo(dias: number) {
  const hoje = diaEmBrasilia();
  const hojeTxt = `${hoje.ano}-${String(hoje.mes).padStart(2, '0')}-${String(hoje.dia).padStart(2, '0')}`;
  return { hoje: hojeTxt, ate: partesEmBrasilia(Date.now() + dias * 86_400_000).data };
}

export async function tratarResposta(db: PoolClient, candidatoId: string, textoRecebido: string) {
  if (!(await cfgBooleano('whatsapp.respostas_automaticas'))) return;
  const e = await db.query<{ id: string; unidade_id: string; situacao: string; inicio_em: Date }>(
    `SELECT id, unidade_id, situacao, inicio_em FROM entrevistas WHERE candidato_id = $1 AND situacao IN ('aguardando_confirmacao', 'remarcacao_solicitada') LIMIT 1`,
    [candidatoId],
  );
  const ent = e.rows[0];
  if (!ent) return; // sem pergunta pendente: a mensagem fica para a equipe responder
  const origem: Origem = { tipo: 'candidato', nome: 'Candidato (WhatsApp)', ator: { usuarioNome: 'Candidato (WhatsApp)' } };
  const chaveBase = `auto:${ent.id}:${Date.now()}`;
  const dias = await cfgNumero('whatsapp.dias_remarcacao');
  const { hoje, ate } = periodo(dias);

  if (ent.situacao === 'aguardando_confirmacao') {
    const r = interpretarSimNao(textoRecebido, lista(await cfg('whatsapp.palavras_sim'), SIM_PADRAO), lista(await cfg('whatsapp.palavras_nao'), NAO_PADRAO));
    if (r === 'sim') {
      await mudarSituacao(db, ent.id, 'confirmar', origem, 'Candidato respondeu SIM pelo WhatsApp', textoRecebido);
      await notificarGestoras(db, ent.unidade_id, 'Entrevista confirmada', `O candidato confirmou a entrevista de ${descrever(ent.inicio_em)}.`, `/conversas?c=${candidatoId}`);
      await responder(db, candidatoId, `Perfeito! Sua entrevista está confirmada para ${descrever(ent.inicio_em)}. Até lá!`, `${chaveBase}:sim`);
      return;
    }
    if (r === 'nao') {
      await mudarSituacao(db, ent.id, 'solicitar_remarcacao', origem, 'Candidato respondeu NÃO pelo WhatsApp', textoRecebido);
      const livres = (await horariosDaUnidade(db, ent.unidade_id, hoje, ate, ent.id)).filter((h) => h.livres > 0);
      await notificarGestoras(db, ent.unidade_id, 'Candidato pediu outra data', `Não pode na entrevista de ${descrever(ent.inicio_em)}.`, `/conversas?c=${candidatoId}`);
      if (!livres.length) {
        await responder(db, candidatoId, 'Sem problemas! No momento não temos outras datas disponíveis. A equipe de RH vai entrar em contato com você.', `${chaveBase}:nao-sem-datas`);
        return;
      }
      await responder(db, candidatoId, `Sem problemas! Temos outras datas disponíveis para sua entrevista.\n\nEntre os dias ${br(livres[0].data)} e ${br(livres[livres.length - 1].data)}, qual seria o melhor dia para você?`, `${chaveBase}:nao`);
      return;
    }
    await eventoEntrevista(db, ent.id, 'esclarecimento_pedido', textoRecebido, { motivo: 'Resposta não foi SIM nem NÃO' });
    await responder(db, candidatoId, `Desculpe, não entendi. Você pode comparecer à entrevista de ${descrever(ent.inicio_em)}? Responda apenas SIM ou NÃO.`, `${chaveBase}:esclarecer`);
    return;
  }

  // ── Pediu outra data ──
  const livres = (await horariosDaUnidade(db, ent.unidade_id, hoje, ate, ent.id)).filter((h) => h.livres > 0);
  if (!livres.length) {
    await eventoEntrevista(db, ent.id, 'data_proposta', textoRecebido, { aceita: false, motivo: 'Sem horários livres' });
    await responder(db, candidatoId, 'No momento não temos datas disponíveis. A equipe de RH vai entrar em contato com você.', `${chaveBase}:sem-datas`);
    return;
  }
  const de = livres[0].data;
  const fim = livres[livres.length - 1].data;
  let resultado = interpretarData(textoRecebido, hoje, de, fim);

  // Só o horário ("às 14h"), respondendo a uma pergunta anterior sobre um dia: usa o dia proposto antes.
  if (resultado.tipo === 'ambiguo') {
    const ultimo = await db.query<{ data_interpretada: Date }>(
      `SELECT data_interpretada FROM entrevista_eventos WHERE entrevista_id = $1 AND tipo = 'data_proposta' AND data_interpretada IS NOT NULL AND em > now() - interval '24 hours'
        ORDER BY em DESC LIMIT 1`,
      [ent.id],
    );
    const soHora = interpretarData(`hoje ${textoRecebido}`, hoje, hoje, hoje);
    if (ultimo.rows[0] && soHora.tipo === 'data' && soHora.hora) resultado = { tipo: 'data', datas: [partesEmBrasilia(ultimo.rows[0].data_interpretada).data], hora: soHora.hora };
  }

  if (resultado.tipo === 'ambiguo') {
    await eventoEntrevista(db, ent.id, 'esclarecimento_pedido', textoRecebido, { motivo: resultado.motivo });
    await responder(db, candidatoId, `Não consegui identificar a data. Entre os dias ${br(de)} e ${br(fim)}, qual seria o melhor dia para você? (por exemplo: ${br(livres[0].data)})`, `${chaveBase}:esclarecer`);
    return;
  }

  const porData = (d: string) => livres.filter((h) => h.data === d);
  const comVaga = resultado.datas.filter((d) => porData(d).length);
  if (!comVaga.length) {
    await eventoEntrevista(db, ent.id, 'data_proposta', textoRecebido, { data: instanteEmBrasilia(resultado.datas[0], '00:00'), aceita: false, motivo: 'Dia sem horário livre' });
    const sugestao = [...new Set(livres.map((h) => h.data))].slice(0, 5).map(br).join(', ');
    await responder(db, candidatoId, `Esse dia não tem horário disponível. Os próximos dias com horário são: ${sugestao}. Qual prefere?`, `${chaveBase}:sem-vaga`);
    return;
  }
  if (comVaga.length > 1) {
    await eventoEntrevista(db, ent.id, 'esclarecimento_pedido', textoRecebido, { motivo: 'Mais de uma data possível' });
    await responder(db, candidatoId, `Qual destas datas: ${comVaga.map(br).join(' ou ')}?`, `${chaveBase}:qual-data`);
    return;
  }

  const dia = comVaga[0];
  const horarios = porData(dia);
  let escolhido: Horario | undefined;
  if (resultado.hora) escolhido = horarios.find((h) => h.hora === resultado.hora);
  else if (horarios.length === 1) escolhido = horarios[0];

  if (!escolhido) {
    await eventoEntrevista(db, ent.id, 'data_proposta', textoRecebido, { data: instanteEmBrasilia(dia, '00:00'), aceita: null, motivo: resultado.hora ? 'Horário sem vaga' : 'Falta escolher o horário' });
    await responder(db, candidatoId, `${resultado.hora ? `Às ${resultado.hora} não temos vaga. ` : ''}No dia ${br(dia)} temos: ${horarios.map((h) => h.hora).join(', ')}. Qual horário prefere?`, `${chaveBase}:qual-hora`);
    return;
  }

  // Data e horário válidos: remarca (com nova conferência de vaga, com trava) e confirma, porque foi o candidato que escolheu.
  const inicio = new Date(escolhido.inicioEm);
  await eventoEntrevista(db, ent.id, 'data_proposta', textoRecebido, { data: inicio, aceita: true });
  const nova = await remarcar(db, ent.id, inicio, origem, 'Data escolhida pelo candidato no WhatsApp', textoRecebido);
  await mudarSituacao(db, nova, 'confirmar', origem, 'Data escolhida pelo próprio candidato', textoRecebido);
  await notificarGestoras(db, ent.unidade_id, 'Entrevista remarcada pelo candidato', `Nova data: ${descrever(inicio)} (confirmada).`, `/conversas?c=${candidatoId}`);
  await responder(db, candidatoId, `Pronto! Sua entrevista foi remarcada e está confirmada para ${descrever(inicio)}. Até lá!`, `${chaveBase}:remarcada`);
}

