import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Busca dados de uma rota da API, com estado de carregamento, erro e recarga. */
export function useDados<T>(url: string | null) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<ApiError | null>(null);
  const [carregando, setCarregando] = useState(Boolean(url));

  const recarregar = useCallback(async () => {
    if (!url) return;
    setCarregando(true);
    try {
      setDados(await api.get<T>(url));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e : new ApiError(0, 'Erro inesperado.'));
    } finally {
      setCarregando(false);
    }
  }, [url]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { dados, erro, carregando, recarregar, setDados };
}
