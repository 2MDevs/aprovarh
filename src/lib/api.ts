/**
 * Cliente da API. Sempre com o cookie de sessão (mesma origem).
 * Erros especiais avisam a aplicação inteira por eventos:
 *   sem_sessao       → volta para o login
 *   sessao_bloqueada → mostra a tela de desbloqueio
 *   trocar_senha     → leva para a troca de senha obrigatória
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public codigo?: string,
  ) {
    super(message);
  }
}

export const EVENTO_SESSAO = 'arh:sessao';

async function requisicao<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: metodo,
      credentials: 'same-origin',
      headers: corpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira sua internet.', 'sem_conexao');
  }
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json().catch(() => null) : null;
  if (!resp.ok) {
    const erro = new ApiError(resp.status, dados?.erro || 'Algo deu errado. Tente novamente.', dados?.codigo);
    if (['sem_sessao', 'sessao_bloqueada', 'trocar_senha'].includes(erro.codigo || '') && !url.startsWith('/api/auth/login')) {
      window.dispatchEvent(new CustomEvent(EVENTO_SESSAO, { detail: erro.codigo }));
    }
    throw erro;
  }
  return dados as T;
}

export const api = {
  get: <T>(url: string) => requisicao<T>('GET', url),
  post: <T>(url: string, corpo: unknown = {}) => requisicao<T>('POST', url, corpo),
  put: <T>(url: string, corpo: unknown) => requisicao<T>('PUT', url, corpo),
  del: <T>(url: string) => requisicao<T>('DELETE', url),
};

export function query(params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
