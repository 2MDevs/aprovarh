import rateLimit from 'express-rate-limit';

/** 10 tentativas a cada 15 minutos por IP nas rotas de login, 2FA, senha, PIN e reautenticação. */
export const limiteAutenticacao = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.', codigo: 'muitas_tentativas' },
});

/** Limite geral da API, para conter abusos sem atrapalhar o uso normal. */
export const limiteGeral = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde um instante.', codigo: 'muitas_requisicoes' },
});
