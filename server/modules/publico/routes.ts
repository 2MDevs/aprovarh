import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import { auditar } from '../../core/audit.ts';
import { cfgNumero } from '../../core/settings.ts';
import { detectarTipo, type TipoAceito } from '../../lib/arquivos.ts';
import { descreverDispositivo } from '../../lib/device.ts';
import { capitalizarNome, cpfValido, nomeValido, normalizarTelefone, soDigitos } from '../../lib/documentos.ts';
import { badRequest, h, HttpError, ipDe, parse } from '../../lib/http.ts';
import { avisoAtual, registrarCandidatura, unidadesAbertas } from './service.ts';

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

const limiteEnvio = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  skipFailedRequests: true, // corrigir um campo errado não gasta o limite
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitos envios a partir desta conexão. Tente de novo em uma hora.', codigo: 'muitas_tentativas' },
});

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

publicoRouter.post('/candidaturas', limiteEnvio, h(async (req, res) => {
  const aviso = await avisoAtual();
  if (!aviso) throw new HttpError(503, MENSAGEM_FECHADO, 'cadastro_fechado');

  await receberArquivos(req, res);
  const ip = ipDe(req);
  const body = parse(campos, req.body);

  // Robô preencheu o campo invisível: responde como sucesso e não grava nada.
  if (body.site) {
    await auditar({ acao: 'candidatura.robo', resultado: 'negado', ator: { usuarioNome: 'Formulário público de candidatura' }, ip, dispositivo: descreverDispositivo(req.get('user-agent')).nome });
    return res.status(201).json({ ok: true });
  }
  if (body.avisoVersao !== aviso.versao) {
    throw badRequest('O aviso de privacidade foi atualizado. Recarregue a página, leia e aceite de novo.', 'aviso_mudou');
  }

  const telefone = normalizarTelefone(body.telefone);
  if (!telefone) throw badRequest('Telefone inválido. Informe o DDD e o número, por exemplo (11) 91234-5678.', 'telefone_invalido');

  const arquivos = req.files as Record<string, Express.Multer.File[]> | undefined;
  const cv = arquivos?.curriculo?.[0];
  const ft = arquivos?.foto?.[0];
  if (!cv) throw badRequest('Envie seu currículo.', 'sem_curriculo');
  if (!ft) throw badRequest('Envie sua foto 3x4.', 'sem_foto');

  const [limiteCv, limiteFoto] = await Promise.all([cfgNumero('arquivos.curriculo_mb'), cfgNumero('arquivos.foto_mb')]);
  const tipoCv = detectarTipo(cv.buffer);
  if (!tipoCv || !CURRICULO.includes(tipoCv)) throw badRequest('O currículo precisa ser um arquivo PDF, DOC ou DOCX.', 'curriculo_tipo');
  if (cv.size > limiteCv * 1024 * 1024) throw badRequest(`O currículo pode ter no máximo ${limiteCv} MB.`, 'curriculo_grande');
  const tipoFoto = detectarTipo(ft.buffer);
  if (!tipoFoto || !FOTO.includes(tipoFoto)) throw badRequest('A foto precisa ser uma imagem JPG ou PNG.', 'foto_tipo');
  if (ft.size > limiteFoto * 1024 * 1024) throw badRequest(`A foto pode ter no máximo ${limiteFoto} MB.`, 'foto_grande');

  try {
    await registrarCandidatura({
      nome: capitalizarNome(body.nome),
      sobrenome: capitalizarNome(body.sobrenome),
      cpf: soDigitos(body.cpf),
      telefone,
      unidadeId: body.unidadeId,
      curriculo: { conteudo: cv.buffer, nome: cv.originalname, tipo: tipoCv },
      foto: { conteudo: ft.buffer, nome: ft.originalname, tipo: tipoFoto },
      avisoVersao: aviso.versao,
      ip,
    });
  } catch (err) {
    if ((err as Error).message === 'UNIDADE_INVALIDA') throw badRequest('Essa unidade não está recebendo candidaturas. Escolha outra.', 'unidade_invalida');
    throw err;
  }
  // Mesma resposta para CPF novo ou repetido.
  res.status(201).json({ ok: true });
}));
