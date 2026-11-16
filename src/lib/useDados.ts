import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** Busca dados de uma rota da API, com estado de carregamento, erro e recarga. */
export function useDados<T>(url: string | null) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<ApiError | null>(null);
  const [carregando, setCarregando] = useState(Boolean(url));

  const pedido = useRef(0);

  const recarregar = useCallback(async () => {
    if (!url) return;
    const meu = ++pedido.current; // se outra busca começar depois, só a mais nova vale
    setCarregando(true);
    try {
      const d = await api.get<T>(url);
      if (meu !== pedido.current) return;
      setDados(d);
      setErro(null);
    } catch (e) {
      if (meu === pedido.current) setErro(e instanceof ApiError ? e : new ApiError(0, 'Erro inesperado.'));
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [url]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { dados, erro, carregando, recarregar, setDados };
}
