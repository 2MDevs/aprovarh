import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

/** Erro com mensagem que pode ser mostrada ao usuário. Qualquer outro erro vira "erro interno". */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public codigo?: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, codigo?: string) => new HttpError(400, msg, codigo);
export const unauthorized = (msg = 'Sua sessão terminou. Entre novamente.', codigo = 'sem_sessao') => new HttpError(401, msg, codigo);
export const forbidden = (msg = 'Você não tem permissão para fazer isso.', codigo = 'sem_permissao') => new HttpError(403, msg, codigo);
export const notFound = (msg = 'Não encontrado.') => new HttpError(404, msg, 'nao_encontrado');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflito');
export const tooMany = (msg: string) => new HttpError(429, msg, 'muitas_tentativas');

/** Envolve handlers async para que erros cheguem ao tratador central. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Valida o corpo/consulta com Zod; erros viram mensagem simples. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const primeira = r.error.issues[0];
    throw badRequest(primeira?.message || 'Dados inválidos.', 'dados_invalidos');
  }
  return r.data;
}

/** Tratador central: nunca mostra stack, SQL ou detalhes técnicos ao usuário. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ erro: 'Dados inválidos.', codigo: 'dados_invalidos' });
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'O envio é grande demais.', codigo: 'muito_grande' });
  }
  console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
  return res.status(500).json({ erro: 'Ocorreu um erro inesperado. Tente novamente.', codigo: 'erro_interno' });
}

export function ipDe(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64);
}
