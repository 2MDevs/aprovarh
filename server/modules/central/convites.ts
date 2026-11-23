import { Router } from 'express';
import multer from 'multer';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { env } from '../../config/env.ts';
import { enxergaUnidade } from '../../core/access.ts';
import { auditarReq } from '../../core/audit.ts';
import { cfg, cfgNumero } from '../../core/settings.ts';
import { publicar } from '../../core/tempoReal.ts';
import { pool, transaction } from '../../db/pool.ts';
import { descartarArquivos, detectarTipo, guardarArquivo, type ArquivoGuardado, type TipoAceito } from '../../lib/arquivos.ts';
import { encrypt, hmac, randomToken } from '../../lib/crypto.ts';
import { capitalizarNome, nomeValido, normalizarTelefone } from '../../lib/documentos.ts';
import { candidatosDaPlanilha, ErroPlanilha, lerPlanilha } from '../../lib/planilha.ts';
import { badRequest, forbidden, h, parse } from '../../lib/http.ts';
import { exigirLogin, exigirPermissao } from '../../middleware/auth.ts';
import { gravarLinhaDoTempoInicial } from '../publico/service.ts';
import { enfileirar } from '../whatsapp/envio.ts';
import { escolherHorario, janela } from './agendaConvites.ts';
import { candidatoVisivel } from './service.ts';

/**
 * Pré-cadastro e convite (decisão D47).
 * O RH cadastra quem mandou só o currículo e envia um convite pelo WhatsApp com o link para completar o cadastro.
 * Os convites saem ESPAÇADOS (intervalo, limite por dia e horário configuráveis), para diminuir o risco de bloqueio do número.
 */
export const convitesRouter = Router();
convitesRouter.use(exigirLogin(), exigirPermissao('candidatos.ver'), exigirPermissao('candidatos.editar'));

const CURRICULO: TipoAceito[] = ['pdf', 'doc', 'docx'];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 } });
const VALIDADE_CONVITE_DIAS = 7;

/**
 * Próximo horário livre para um convite: depois do último agendado + intervalo (com uma variação de até 50%),
 * dentro do horário de envio e sem passar do limite do dia. Roda com trava para dois pedidos não pegarem o mesmo horário.
 */
export async function proximoHorarioConvite(db: PoolClient, agora = new Date()): Promise<Date> {
  await db.query('SELECT pg_advisory_xact_lock(7240140)');
  const [intervaloSeg, porDia, j] = await Promise.all([cfgNumero('whatsapp.convite_intervalo_segundos'), cfgNumero('whatsapp.convites_por_dia'), cfg('whatsapp.convite_horario').then(janela)]);
  const ultimo = (await db.query<{ ultimo: Date | null }>('SELECT max(convite_agendado_para) AS ultimo FROM candidatos')).rows[0].ultimo;
  return escolherHorario(agora, ultimo ? new Date(ultimo) : null, { intervaloSeg, porDia, janela: j }, async (dia) => (await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM candidatos WHERE convite_agendado_para >= $1 AND convite_agendado_para < $2', [dia, new Date(dia.getTime() + 86_400_000)],
  )).rows[0].n);
}

/** Gera o link (o token só existe aqui, na mensagem) e agenda o envio. */
async function agendarConvite(db: PoolClient, candidatoId: string, usuario: { id: string; nome: string }): Promise<Date> {
  const r = await db.query<{ nome: string; unidade: string; pendente: boolean }>(
    `SELECT c.nome, un.nome AS unidade, c.cadastro_pendente AS pendente FROM candidatos c JOIN unidades un ON un.id = c.unidade_id
      WHERE c.id = $1 AND c.excluido_em IS NULL FOR UPDATE OF c`, [candidatoId],
  );
  const c = r.rows[0];
  if (!c) throw badRequest('Candidato não encontrado.');
  if (!c.pendente) throw badRequest('Este candidato já completou o cadastro.', 'cadastro_completo');
  const token = randomToken(24);
  const quando = await proximoHorarioConvite(db);
  await db.query(
    `UPDATE candidatos SET convite_token_hash = $2, convite_expira_em = $3::timestamptz + interval '${VALIDADE_CONVITE_DIAS} days',
       convite_agendado_para = $3, convite_enviado_em = now(), convite_enviado_por = $4, atualizado_em = now() WHERE id = $1`,
    [candidatoId, hmac(`convite:${token}`), quando, usuario.id],
  );
  const base = env.APP_URL.replace(/\/+$/, '');
  const modelo = (await cfg('whatsapp.texto_convite')) ?? '';
  const montar = (link: string) => modelo.replaceAll('{nome}', c.nome).replaceAll('{unidade}', c.unidade).replaceAll('{link}', link);
  await enfileirar(db, {
    candidatoId,
    conteudo: { tipo: 'texto', texto: montar(`${base}/candidatura?convite=${token}`) },
    textoNaConversa: montar(`${base}/candidatura?convite=…`), // o link completo não fica guardado
    autor: { tipo: 'gestora', usuarioId: usuario.id, nome: usuario.nome },
    chaveIdempotencia: `convite:${candidatoId}:${Date.now()}`,
    enviarEm: quando,
  });
  return quando;
}

// ── Pré-cadastro ──────────────────────────────────────────────────────────

export interface DadosPreCadastro { nome: string; sobrenome: string; telefone: string; unidadeId: string }

/**
 * Cria a ficha pendente (sem CPF e sem aceite do aviso). O currículo é opcional.
 * Recusa telefone que já é de outro candidato. Chamada dentro de uma transação.
 */
export async function criarPreCadastro(
  db: PoolClient, d: DadosPreCadastro, u: { id: string; nome: string },
  curriculo: { conteudo: Buffer; nome: string; tipo: TipoAceito } | null, gravados: ArquivoGuardado[], origem = 'Pré-cadastro feito',
): Promise<{ id: string; codigo: string }> {
  const telHash = hmac(`tel:${d.telefone}`);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [telHash]);
  const ja = await db.query<{ codigo: string }>('SELECT codigo FROM candidatos WHERE telefone_hash = $1 AND excluido_em IS NULL LIMIT 1', [telHash]);
  if (ja.rowCount) throw badRequest(`Já existe um candidato com esse telefone (${ja.rows[0].codigo}).`, 'telefone_existe');
  const inicial = (await db.query<{ id: string; etapa_portal: string; situacao_portal: string }>(`SELECT id, etapa_portal, situacao_portal FROM status WHERE chave_sistema = 'novo'`)).rows[0];
  const arq = curriculo ? await guardarArquivo(db, curriculo.conteudo, curriculo.nome, curriculo.tipo) : null;
  if (arq) gravados.push(arq);
  const c = await db.query<{ id: string; codigo: string }>(
    `INSERT INTO candidatos (nome, sobrenome, telefone, telefone_hash, telefone_final, unidade_id, status_id, curriculo_id,
       origem, cadastro_pendente, pre_cadastrado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rh',true,$9) RETURNING id, codigo`,
    [d.nome, d.sobrenome, encrypt(d.telefone), telHash, d.telefone.slice(-4), d.unidadeId, inicial.id, arq?.id ?? null, u.id],
  );
  const id = c.rows[0].id;
  await db.query('INSERT INTO conversas (candidato_id) VALUES ($1)', [id]);
  if (arq) await db.query(`INSERT INTO candidato_arquivos (candidato_id, arquivo_id, tipo, enviado_por) VALUES ($1, $2, 'curriculo', 'gestora')`, [id, arq.id]);
  await db.query(
    `INSERT INTO status_historico (candidato_id, status_novo_id, autor_tipo, autor_nome, motivo) VALUES ($1, $2, 'usuario', $3, 'Pré-cadastro feito pelo RH')`,
    [id, inicial.id, u.nome],
  );
  await gravarLinhaDoTempoInicial(db, id, inicial);
  const msg = await db.query<{ id: string; criado_em: Date }>(
    `INSERT INTO mensagens (conversa_id, sentido, canal, autor_tipo, autor_nome, texto, visivel_ao_candidato)
     SELECT id, 'entrada', 'sistema', 'sistema', 'Sistema', $2, false FROM conversas WHERE candidato_id = $1 RETURNING id, criado_em`,
    [id, encrypt(`${origem} por ${u.nome}. Falta o candidato completar o cadastro pelo convite.`)],
  );
  await db.query('UPDATE conversas SET ultima_mensagem_id = $2, ultima_mensagem_em = $3 WHERE candidato_id = $1', [id, msg.rows[0].id, msg.rows[0].criado_em]);
  await publicar(db, { tipo: 'candidatura.nova', candidatoId: id, unidadeId: d.unidadeId });
  return c.rows[0];
}

const camposPre = z.object({
  nome: z.string().trim().min(2, 'Informe o nome.').max(80).refine(nomeValido, 'Nome: só letras.'),
  sobrenome: z.string().trim().max(120).refine((v) => !v || nomeValido(v), 'Sobrenome: só letras.').default(''),
  telefone: z.string().max(30),
  unidadeId: z.string().uuid('Escolha a unidade.'),
  enviarConvite: z.enum(['true', 'false']).default('false'),
});

convitesRouter.post('/pre-cadastro', (req, res, next) => {
  upload.single('curriculo')(req, res, (err?: unknown) => (err ? next(badRequest('Arquivo inválido ou grande demais (máximo 10 MB).')) : next()));
}, h(async (req, res) => {
  const u = req.usuario!;
  const b = parse(camposPre, req.body);
  if (!enxergaUnidade(u, b.unidadeId)) throw forbidden('Você não tem acesso a esta unidade.');
  const telefone = normalizarTelefone(b.telefone);
  if (!telefone) throw badRequest('Telefone inválido. Informe o DDD e o número, por exemplo (11) 91234-5678.', 'telefone_invalido');
  // Currículo opcional.
  const cv = req.file;
  let curriculo: { conteudo: Buffer; nome: string; tipo: TipoAceito } | null = null;
  if (cv) {
    const tipo = detectarTipo(cv.buffer);
    if (!tipo || !CURRICULO.includes(tipo)) throw badRequest('O currículo precisa ser PDF, DOC ou DOCX.', 'curriculo_tipo');
    const limite = await cfgNumero('arquivos.curriculo_mb');
    if (cv.size > limite * 1024 * 1024) throw badRequest(`O currículo pode ter no máximo ${limite} MB.`, 'curriculo_grande');
    curriculo = { conteudo: cv.buffer, nome: cv.originalname, tipo };
  }
  const gravados: ArquivoGuardado[] = [];
  try {
    const r = await transaction(async (db) => {
      const un = await db.query('SELECT 1 FROM unidades WHERE id = $1 AND excluido_em IS NULL', [b.unidadeId]);
      if (!un.rowCount) throw badRequest('Unidade não encontrada.');
      const c = await criarPreCadastro(db, { nome: capitalizarNome(b.nome), sobrenome: b.sobrenome ? capitalizarNome(b.sobrenome) : '', telefone, unidadeId: b.unidadeId }, u, curriculo, gravados);
      const agendado = b.enviarConvite === 'true' ? await agendarConvite(db, c.id, u) : null;
      return { ...c, agendado };
    });
    await auditarReq(req, { acao: 'candidato.pre_cadastrado', resultado: 'sucesso', item: { tipo: 'candidato', id: r.id, nome: r.codigo }, detalhes: { conviteAgendadoPara: r.agendado, comCurriculo: Boolean(curriculo) } });
    res.status(201).json({ id: r.id, codigo: r.codigo, conviteAgendadoPara: r.agendado });
  } catch (err) {
    await descartarArquivos(gravados);
    throw err;
  }
}));

// ── Importar planilha (Excel ou CSV) ──────────────────────────────────────
const sem = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Importa os candidatos de uma planilha como pré-cadastros (sem currículo e SEM enviar convite).
 * Com previa=true só confere e mostra o que vai acontecer. Cada linha é salva sozinha: uma linha com problema não
 * impede as outras.
 */
convitesRouter.post('/importar', (req, res, next) => {
  upload.single('arquivo')(req, res, (err?: unknown) => (err ? next(badRequest('Arquivo inválido ou grande demais (máximo 10 MB).')) : next()));
}, h(async (req, res) => {
  const u = req.usuario!;
  const b = parse(z.object({ unidadeId: z.string().uuid().optional().or(z.literal('')), previa: z.enum(['true', 'false']).default('true') }), req.body);
  if (!req.file) throw badRequest('Escolha a planilha.', 'sem_arquivo');
  let lidas: ReturnType<typeof candidatosDaPlanilha>;
  try {
    lidas = candidatosDaPlanilha(lerPlanilha(req.file.buffer));
  } catch (err) {
    if (err instanceof ErroPlanilha) throw badRequest(err.message, 'planilha_invalida');
    throw badRequest('Não foi possível ler a planilha. Salve como Excel (.xlsx) ou CSV e tente de novo.', 'planilha_invalida');
  }
  if (!lidas.candidatos.length) throw badRequest('A planilha não tem nenhuma pessoa abaixo da linha dos títulos.', 'planilha_vazia');
  if (lidas.candidatos.length > 1000) throw badRequest('Máximo de 1000 pessoas por planilha.', 'planilha_grande');

  const unidades = (await pool.query<{ id: string; nome: string }>('SELECT id, nome FROM unidades WHERE excluido_em IS NULL')).rows.filter((x) => enxergaUnidade(u, x.id));
  const padrao = b.unidadeId ? unidades.find((x) => x.id === b.unidadeId) ?? null : null;
  if (b.unidadeId && !padrao) throw forbidden('Você não tem acesso a esta unidade.');

  type Resultado = { linha: number; nome: string; telefone: string; unidade: string | null; situacao: 'ok' | 'erro'; mensagem: string; codigo?: string };
  const resultados: Resultado[] = [];
  const vistos = new Set<string>();
  for (const l of lidas.candidatos) {
    const nome = l.nome ? capitalizarNome(l.nome) : '';
    const sobrenome = l.sobrenome ? capitalizarNome(l.sobrenome) : '';
    const tel = normalizarTelefone(l.telefone);
    const un = l.unidade ? unidades.find((x) => sem(x.nome) === sem(l.unidade)) ?? null : padrao;
    const base = { linha: l.linha, nome: `${nome} ${sobrenome}`.trim(), telefone: l.telefone, unidade: un?.nome ?? null };
    const erro = !nomeValido(nome) ? 'Nome inválido (só letras).'
      : sobrenome && !nomeValido(sobrenome) ? 'Sobrenome inválido (só letras).'
      : !tel ? 'Telefone inválido.'
      : !un ? (l.unidade ? `Unidade "${l.unidade}" não encontrada.` : 'Escolha a unidade.')
      : vistos.has(tel) ? 'Telefone repetido na planilha.' : null;
    if (erro) { resultados.push({ ...base, situacao: 'erro', mensagem: erro }); continue; }
    vistos.add(tel!);
    if (b.previa === 'true') {
      const ja = await pool.query<{ codigo: string }>('SELECT codigo FROM candidatos WHERE telefone_hash = $1 AND excluido_em IS NULL LIMIT 1', [hmac(`tel:${tel}`)]);
      resultados.push(ja.rowCount ? { ...base, situacao: 'erro', mensagem: `Já cadastrado (${ja.rows[0].codigo}).` } : { ...base, situacao: 'ok', mensagem: 'Pronto para importar.' });
      continue;
    }
    try {
      const c = await transaction((db) => criarPreCadastro(db, { nome, sobrenome, telefone: tel!, unidadeId: un!.id }, u, null, [], 'Pré-cadastro importado da planilha'));
      resultados.push({ ...base, situacao: 'ok', mensagem: 'Importado.', codigo: c.codigo });
    } catch (err) {
      resultados.push({ ...base, situacao: 'erro', mensagem: err instanceof Error ? err.message : 'Falhou.' });
    }
  }
  const ok = resultados.filter((r) => r.situacao === 'ok').length;
  if (b.previa !== 'true') {
    await auditarReq(req, { acao: 'candidato.planilha_importada', resultado: 'sucesso', detalhes: { arquivo: req.file.originalname, importados: ok, comErro: resultados.length - ok } });
  }
  res.json({ previa: b.previa === 'true', colunas: lidas.colunas, total: resultados.length, ok, erros: resultados.length - ok, resultados });
}));

// ── Convites ──────────────────────────────────────────────────────────────
convitesRouter.post('/candidato/:id', h(async (req, res) => {
  const id = parse(z.string().uuid(), req.params.id);
  await candidatoVisivel(req.usuario!, id);
  const quando = await transaction((db) => agendarConvite(db, id, req.usuario!));
  await auditarReq(req, { acao: 'candidato.convite_agendado', resultado: 'sucesso', item: { tipo: 'candidato', id }, detalhes: { agendadoPara: quando } });
  res.json({ agendadoPara: quando });
}));

/** Convida de uma vez todos os pré-cadastros pendentes que ainda não receberam convite (das unidades que a pessoa enxerga). */
convitesRouter.post('/pendentes', h(async (req, res) => {
  const u = req.usuario!;
  const { rows } = await pool.query<{ id: string; unidade_id: string }>(
    `SELECT id, unidade_id FROM candidatos WHERE cadastro_pendente AND excluido_em IS NULL AND convite_enviado_em IS NULL ORDER BY criado_em`,
  );
  const meus = rows.filter((r) => enxergaUnidade(u, r.unidade_id)).slice(0, 300);
  let ultimo: Date | null = null;
  for (const c of meus) ultimo = await transaction((db) => agendarConvite(db, c.id, u));
  await auditarReq(req, { acao: 'candidato.convites_em_lote', resultado: 'sucesso', detalhes: { total: meus.length, ultimoAgendadoPara: ultimo } });
  res.json({ total: meus.length, ultimoAgendadoPara: ultimo });
}));

/** Quantos pré-cadastros estão esperando (para o botão da lista). */
convitesRouter.get('/resumo', h(async (req, res) => {
  const u = req.usuario!;
  const { rows } = await pool.query<{ unidade_id: string; sem_convite: number; aguardando: number }>(
    `SELECT unidade_id, count(*) FILTER (WHERE convite_enviado_em IS NULL)::int AS sem_convite,
            count(*) FILTER (WHERE convite_enviado_em IS NOT NULL)::int AS aguardando
       FROM candidatos WHERE cadastro_pendente AND excluido_em IS NULL GROUP BY unidade_id`,
  );
  const meus = rows.filter((r) => enxergaUnidade(u, r.unidade_id));
  res.json({ semConvite: meus.reduce((a, r) => a + r.sem_convite, 0), aguardando: meus.reduce((a, r) => a + r.aguardando, 0) });
}));
