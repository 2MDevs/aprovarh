import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Permissao } from '@shared/permissoes';
import { api, EVENTO_SESSAO } from '../lib/api';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  setor: string | null;
  perfil: string;
  perfilChave: string;
  desenvolvedor: boolean;
  todasUnidades: boolean;
  unidades: string[];
  temPin: boolean;
  permissoes: Permissao[];
}

export interface Sessao {
  logado: boolean;
  bloqueada?: boolean;
  deveTrocarSenha?: boolean;
  modoConfiguracao?: boolean;
  smtpConfigurado: boolean;
  bloqueioMinutos?: number;
  usuario?: Usuario;
}

interface Contexto {
  sessao: Sessao | null;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
  pode: (p: Permissao) => boolean;
}

const Ctx = createContext<Contexto>(null!);
export const useSessao = () => useContext(Ctx);

/** Eventos que contam como "uso" para o bloqueio por inatividade. */
const ATIVIDADE = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const ultimoUso = useRef(Date.now());

  const recarregar = useCallback(async () => {
    try {
      setSessao(await api.get<Sessao>('/api/auth/sessao'));
    } catch {
      setSessao((s) => s ?? { logado: false, smtpConfigurado: false });
    }
  }, []);

  const sair = useCallback(async () => {
    try {
      await api.post('/api/auth/sair');
    } finally {
      setSessao({ logado: false, smtpConfigurado: sessao?.smtpConfigurado ?? false });
    }
  }, [sessao?.smtpConfigurado]);

  // Primeira leitura e conferência periódica (não renova a sessão no servidor).
  useEffect(() => {
    void recarregar();
    const t = setInterval(() => void recarregar(), 60_000);
    const aoVoltar = () => document.visibilityState === 'visible' && void recarregar();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [recarregar]);

  // Respostas da API que mudam o estado da sessão (sessão terminou, tela bloqueada, trocar senha).
  useEffect(() => {
    const ouvir = () => void recarregar();
    window.addEventListener(EVENTO_SESSAO, ouvir);
    return () => window.removeEventListener(EVENTO_SESSAO, ouvir);
  }, [recarregar]);

  // Bloqueio por inatividade do lado da tela (o servidor também bloqueia sozinho).
  useEffect(() => {
    if (!sessao?.logado || sessao.bloqueada || !sessao.bloqueioMinutos) return;
    const marcar = () => (ultimoUso.current = Date.now());
    ATIVIDADE.forEach((ev) => window.addEventListener(ev, marcar, { passive: true }));
    const t = setInterval(async () => {
      if (Date.now() - ultimoUso.current > sessao.bloqueioMinutos! * 60_000) {
        await api.post('/api/auth/bloquear').catch(() => {});
        void recarregar();
      }
    }, 15_000);
    return () => {
      ATIVIDADE.forEach((ev) => window.removeEventListener(ev, marcar));
      clearInterval(t);
    };
  }, [sessao?.logado, sessao?.bloqueada, sessao?.bloqueioMinutos, recarregar]);

  const pode = useCallback((p: Permissao) => Boolean(sessao?.usuario?.permissoes.includes(p)), [sessao]);

  return <Ctx.Provider value={{ sessao, recarregar, sair, pode }}>{children}</Ctx.Provider>;
}
