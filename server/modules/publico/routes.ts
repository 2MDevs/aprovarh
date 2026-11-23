import crypto from 'node:crypto';
import { isProd } from '../../config/env.ts';
import { pool, transaction } from '../../db/pool.ts';
import { COOKIE_PORTAL } from '../portal/routes.ts';
import { abrirSessaoDireta, liberarAcesso } from '../portal/servico.ts';
import { exigirLogin } from '../../middleware/auth.ts';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { auditar } from '../../core/audit.ts';
import { cfg, cfgNumero } from '../../core/settings.ts';
import { detectarTipo, type TipoAceito } from '../../lib/arquivos.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { capitalizarNome, cpfValido, nomeValido, normalizarTelefone, soDigitos } from '../../lib/documentos.ts';
import { badRequest, h, HttpError, ipDe, parse } from '../../lib/http.ts';
import { avisoAtual, completarConvite, lerConvite, registrarCandidatura, unidadesAbertas } from './service.ts';

/**
 * Cadastro público de candidatura (sem login).
 * Proteções: limite por IP, campo-armadilha contra robôs, tipo do arquivo conferido pelo conteúdo,
 * limites de tamanho, arquivos cifrados, resposta igual para CPF novo ou repetido.
 */
export const publicoRouter = Router();

const MAX_ABSOLUTO_MB = 25;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ABSOLUTO_MB * 1024 * 1024, files: 2, fields: 12, fieldSize: 2048, parts: 16 },
});

/** Abrir o link do convite (só leitura). */
const limiteConvite = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { erro: 'Muitas tentativas a partir desta conexão. Tente de novo em uma hora.', codigo: 'muitas_tentativas' } });

const limiteEnvio = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  skipFailedRequests: true, // corrigir um campo errado não gasta o limite
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitos envios a partir desta conexão. Tente de novo em uma hora.', codigo: 'muitas_tentativas' },
});

/** Protocolo curto e sem letras parecidas (0/O, 1/I). */
function novoProtocolo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'RH-' + Array.from(crypto.randomBytes(6), (b: number) => letras[b % letras.length]).join('');
}

/**
 * Botão "Confirmar pelo WhatsApp" (decisão D44): abre a conversa com o número do recrutamento com um texto pronto.
 * Assim é o candidato quem escreve primeiro, o que diminui o risco de bloqueio do número.
 */
async function linkWhatsapp(protocolo: string): Promise<string | null> {
  const numero = (await cfg('whatsapp.numero_recrutamento'))?.replace(/\D/g, '');
  if (!numero || numero.length < 10) return null;
  const texto = `Olá! Acabei de enviar minha candidatura para a Hummm! Pizzas. Protocolo: ${protocolo}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

const MENSAGEM_FECHADO = 'O cadastro de candidaturas está temporariamente indisponível. Tente novamente mais tarde.';

/** Dados para montar o formulário. */
publicoRouter.get('/formulario', h(async (_req, res) => {
  const [aviso, unidades, curriculoMb, fotoMb] = await Promise.all([avisoAtual(), unidadesAbertas(), cfgNumero('arquivos.curriculo_mb'), cfgNumero('arquivos.foto_mb')]);
  // Fechado enquanto faltar o aviso de privacidade ou não houver unidade ativa (a TI vê o motivo na Integração).
  const aberto = Boolean(aviso && unidades.length);
  res.json({
    aberto,
    mensagem: aberto ? null : MENSAGEM_FECHADO,
    unidades: aberto ? unidades : [],
    aviso: aberto ? aviso : null,
    limites: { curriculoMb, fotoMb, curriculo: ['PDF', 'DOC', 'DOCX'], foto: ['JPG', 'PNG'] },
  });
}));

const campos = z.object({
  nome: z.string().trim().max(80).refine(nomeValido, 'Informe seu nome (só letras).'),
  sobrenome: z.string().trim().max(120).refine(nomeValido, 'Informe seu sobrenome (só letras).'),
  telefone: z.string().max(30),
  cpf: z.string().max(20).refine(cpfValido, 'CPF inválido. Confira os números.'),
  unidadeId: z.string().uuid('Escolha a unidade.'),
  aceite: z.literal('true', { message: 'Para continuar, leia e aceite o aviso de privacidade.' }),
  avisoVersao: z.string().regex(/^[0-9a-f]{12}$/),
  site: z.string().max(200).optional(), // campo-armadilha: invisível para pessoas
  convite: z.string().max(100).optional(), // link do pré-cadastro (D47)
});

const CURRICULO: TipoAceito[] = ['pdf', 'doc', 'docx'];
const FOTO: TipoAceito[] = ['jpg', 'png'];

function receberArquivos(req: Express.Request, res: Express.Response) {
  return new Promise<void>((resolve, reject) => {
    upload.fields([{ name: 'curriculo', maxCount: 1 }, { name: 'foto', maxCount: 1 }])(req as never, res as never, (err?: unknown) => {
      if (!err) return resolve();
      const codigo = (err as { code?: string }).code;
      if (codigo === 'LIMIT_FILE_SIZE') return reject(badRequest(`Arquivo grande demais (máximo de ${MAX_ABSOLUTO_MB} MB).`, 'arquivo_grande'));
      if (codigo?.startsWith('LIMIT_')) return reject(badRequest('Envio inválido. Confira os campos e os arquivos.', 'envio_invalido'));
      reject(err);
    });
  });
}

/** Convite do pré-cadastro: o que já está preenchido. Convite inválido ou vencido recebe sempre a mesma resposta. */
publicoRouter.get('/convite/:token', limiteConvite, h(async (req, res) => {
  const c = await lerConvite(String(req.params.token));
  if (!c) throw new HttpError(404, 'Este link de convite não vale mais. Peça um novo ao RH ou preencha o formulário normal.', 'convite_invalido');
  res.json({ nome: c.nome, sobrenome: c.sobrenome, unidadeId: c.unidadeId, telefone: `(••) •••••-${c.telefoneFinal}`, curriculo: c.curriculoNome });
}));

publicoRouter.post('/candidaturas', limiteEnvio, h(async (req, res) => {
  const aviso = await avisoAtual();
  if (!aviso) throw new HttpError(503, MENSAGEM_FECHADO, 'cadastro_fechado');

  await receberArquivos(req, res);
  const ip = ipDe(req);
  const body = parse(campos, req.body);

  // Robô preencheu o campo invisível: responde como sucesso e não grava nada.
  if (body.site) {
    await auditar({ acao: 'candidatura.robo', resultado: 'negado', ator: { usuarioNome: 'Formulário público de candidatura' }, ip, dispositivo: descreverDispositivo(req.get('user-agent')).nome });
    return res.status(201).json({ ok: true, whatsapp: await linkWhatsapp(novoProtocolo()) });
  }
  if (body.avisoVersao !== aviso.versao) {
    throw badRequest('O aviso de privacidade foi atualizado. Recarregue a página, leia e aceite de novo.', 'aviso_mudou');
  }

  const arquivos = req.files as Record<string, Express.Multer.File[]> | undefined;
  const cv = arquivos?.curriculo?.[0];
  const ft = arquivos?.foto?.[0]; // a foto 3x4 é opcional
  const [limiteCv, limiteFoto] = await Promise.all([cfgNumero('arquivos.curriculo_mb'), cfgNumero('arquivos.foto_mb')]);
  const tipoCv = cv ? detectarTipo(cv.buffer) : null;
  if (cv && (!tipoCv || !CURRICULO.includes(tipoCv))) throw badRequest('O currículo precisa ser um arquivo PDF, DOC ou DOCX.', 'curriculo_tipo');
  if (cv && cv.size > limiteCv * 1024 * 1024) throw badRequest(`O currículo pode ter no máximo ${limiteCv} MB.`, 'curriculo_grande');
  const tipoFoto = ft ? detectarTipo(ft.buffer) : null;
  if (ft && (!tipoFoto || !FOTO.includes(tipoFoto))) throw badRequest('A foto precisa ser uma imagem JPG ou PNG.', 'foto_tipo');
  if (ft && ft.size > limiteFoto * 1024 * 1024) throw badRequest(`A foto pode ter no máximo ${limiteFoto} MB.`, 'foto_grande');
  const foto = ft && tipoFoto ? { conteudo: ft.buffer, nome: ft.originalname, tipo: tipoFoto } : null;

  // Convite do pré-cadastro: o currículo já foi enviado pelo RH e o telefone é o do convite. Depois, o portal abre sozinho.
  if (body.convite) {
    let r: Awaited<ReturnType<typeof completarConvite>>;
    try {
      r = await completarConvite({
        token: body.convite, nome: capitalizarNome(body.nome), sobrenome: capitalizarNome(body.sobrenome), cpf: soDigitos(body.cpf),
        unidadeId: body.unidadeId, curriculo: cv && tipoCv ? { conteudo: cv.buffer, nome: cv.originalname, tipo: tipoCv } : null,
        foto, avisoVersao: aviso.versao, ip,
      });
    } catch (err) {
      if ((err as Error).message === 'UNIDADE_INVALIDA') throw badRequest('Essa unidade não está recebendo candidaturas. Escolha outra.', 'unidade_invalida');
      throw err;
    }
    if (!r) throw new HttpError(404, 'Este link de convite não vale mais. Peça um novo ao RH ou preencha o formulário normal.', 'convite_invalido');
    const dispositivo = descreverDispositivo(req.get('user-agent')).nome;
    const final = r;
    const sessao = await transaction(async (db) => {
      const lib = await liberarAcesso(db, final.candidatoId, final.unidadeId,
        { tipo: 'usuario', usuarioId: final.convidadoPor ?? undefined, ator: { usuarioNome: 'Convite do pré-cadastro' } }, { permiteArquivo: true }, ip);
      return { token: await abrirSessaoDireta(db, lib.liberacaoId, final.candidatoId, ip, dispositivo), expiraEm: lib.expiraEm };
    });
    res.cookie(COOKIE_PORTAL, sessao.token, {
      httpOnly: true, secure: isProd, sameSite: 'lax', path: '/', maxAge: Math.max(1000, sessao.expiraEm.getTime() - Date.now()),
    });
    return res.status(201).json({ ok: true, portal: true });
  }

  const telefone = normalizarTelefone(body.telefone);
  if (!telefone) throw badRequest('Telefone inválido. Informe o DDD e o número, por exemplo (11) 91234-5678.', 'telefone_invalido');
  if (!cv || !tipoCv) throw badRequest('Envie seu currículo.', 'sem_curriculo');

  let protocolo = novoProtocolo();
  try {
    const r = await registrarCandidatura({
      nome: capitalizarNome(body.nome),
      sobrenome: capitalizarNome(body.sobrenome),
      cpf: soDigitos(body.cpf),
      telefone,
      unidadeId: body.unidadeId,
      curriculo: { conteudo: cv.buffer, nome: cv.originalname, tipo: tipoCv },
      foto,
      avisoVersao: aviso.versao,
      ip,
    });
    // O protocolo só vale para reconhecer quem escreveu se o telefone do envio é o mesmo da ficha.
    if (!r.telefoneDiferente) {
      await pool.query('INSERT INTO candidatura_protocolos (protocolo, candidato_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [protocolo, r.candidatoId]);
    } else {
      protocolo = novoProtocolo();
    }
  } catch (err) {
    if ((err as Error).message === 'UNIDADE_INVALIDA') throw badRequest('Essa unidade não está recebendo candidaturas. Escolha outra.', 'unidade_invalida');
    throw err;
  }
  // Mesma resposta para CPF novo ou repetido.
  res.status(201).json({ ok: true, whatsapp: await linkWhatsapp(protocolo) });
}));

/** Para a equipe (logada): por que o formulário público está fechado. O candidato nunca vê o motivo. */
export const formularioSituacaoRouter = Router();
formularioSituacaoRouter.get('/', exigirLogin(), h(async (_req, res) => {
  const [aviso, unidades] = await Promise.all([avisoAtual(), unidadesAbertas()]);
  const falta: string[] = [];
  if (!aviso) falta.push('aviso');
  if (!unidades.length) falta.push('unidade');
  res.json({ aberto: falta.length === 0, falta });
}));
