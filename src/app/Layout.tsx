import {
  Bell, Building2, LogOut, Menu, Monitor, Moon, Plug, ScrollText, Server, Smartphone, Sun, UserRound, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Permissao } from '@shared/permissoes';
import { LogoHummm, NomePlataforma } from '../components/Marca';
import { api } from '../lib/api';
import { relativo } from '../lib/formato';
import { aplicarTema, temaSalvo, type Tema } from '../lib/tema';
import { useSessao } from './sessao';

interface ItemMenu {
  rota: string;
  rotulo: string;
  icone: ReactNode;
  permissao?: Permissao | Permissao[];
  somenteDesenvolvedor?: boolean;
}

/** Só aparecem as telas que já existem e que a pessoa pode usar. A Central de RH entra a partir da etapa 3. */
export const MENU: ItemMenu[] = [
  { rota: '/administracao', rotulo: 'Usuários e unidades', icone: <Building2 className="size-5" />, permissao: ['usuarios.gerenciar', 'unidades.gerenciar'] },
  { rota: '/dispositivos', rotulo: 'Dispositivos', icone: <Smartphone className="size-5" /> },
  { rota: '/auditoria', rotulo: 'Auditoria', icone: <ScrollText className="size-5" />, permissao: 'auditoria.ver' },
  { rota: '/sistema', rotulo: 'Sistema', icone: <Server className="size-5" />, permissao: 'sistema.ver' },
  { rota: '/integracao', rotulo: 'Integração', icone: <Plug className="size-5" />, somenteDesenvolvedor: true },
  { rota: '/conta', rotulo: 'Minha conta', icone: <UserRound className="size-5" /> },
];

export function useMenu() {
  const { sessao, pode } = useSessao();
  return MENU.filter((i) => {
    if (i.somenteDesenvolvedor) return Boolean(sessao?.usuario?.desenvolvedor);
    if (!i.permissao) return true;
    return (Array.isArray(i.permissao) ? i.permissao : [i.permissao]).some(pode);
  });
}

export function Layout() {
  const { sessao, sair } = useSessao();
  const menu = useMenu();
  const [aberto, setAberto] = useState(false);
  const local = useLocation();
  useEffect(() => setAberto(false), [local.pathname]);
  const u = sessao!.usuario!;

  const lateral = (
    <nav aria-label="Menu principal" className="flex h-full flex-col bg-grafite text-creme">
      <div className="flex flex-col gap-3 px-6 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
        <LogoHummm fundo="escuro" className="h-9" />
        <NomePlataforma escuro className="text-xl" />
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3">
        {menu.map((i) => (
          <li key={i.rota}>
            <NavLink
              to={i.rota}
              className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition
                ${isActive ? 'bg-amarelo text-grafite' : 'text-creme/75 hover:bg-white/8 hover:text-creme'}`}
            >
              {i.icone}
              {i.rotulo}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-semibold">{u.nome}</p>
        <p className="truncate text-xs text-creme/60">{u.perfil}{u.setor ? ` · ${u.setor}` : ''}</p>
        <button onClick={() => void sair()} className="mt-3 inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm text-creme/75 hover:bg-white/8 hover:text-creme">
          <LogOut className="size-4" /> Sair
        </button>
      </div>
      <div className="faixa-marca h-1" aria-hidden />
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{lateral}</aside>

      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-grafite/50" onClick={() => setAberto(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-[300px] shadow-2xl">{lateral}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-borda bg-fundo/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur lg:px-8">
          <button className="grid size-11 place-items-center rounded-full hover:bg-superficie lg:hidden" onClick={() => setAberto(true)} aria-label="Abrir menu">
            {aberto ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/" className="lg:hidden"><NomePlataforma className="text-lg" /></Link>
          <div className="flex-1" />
          <IndicadorConexao />
          <BotaoTema />
          <Sino />
        </header>

        {sessao?.modoConfiguracao && u.desenvolvedor && (
          <div className="border-b border-amarelo bg-amarelo/25 px-4 py-2.5 text-sm lg:px-8">
            <strong>Configuração inicial pendente.</strong> O e-mail (SMTP) ainda não foi configurado, por isso o 2FA está desligado.{' '}
            <Link to="/integracao?aba=integracoes&abrir=smtp" className="font-semibold underline">Configurar agora</Link>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function BotaoTema() {
  const [tema, setTema] = useState<Tema>(temaSalvo);
  const proximo: Record<Tema, Tema> = { sistema: 'claro', claro: 'escuro', escuro: 'sistema' };
  const rotulo = { sistema: 'Tema do aparelho', claro: 'Tema claro', escuro: 'Tema escuro' }[tema];
  const Icone = { sistema: Monitor, claro: Sun, escuro: Moon }[tema];
  return (
    <button
      onClick={() => {
        const t = proximo[tema];
        setTema(t);
        aplicarTema(t);
      }}
      className="grid size-11 place-items-center rounded-full hover:bg-superficie"
      aria-label={`${rotulo}. Tocar para trocar`}
      title={rotulo}
    >
      <Icone className="size-5" />
    </button>
  );
}

/** "Conectado" vem do /api/health (banco no ar). */
function IndicadorConexao() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const ver = () => fetch('/api/health', { cache: 'no-store' }).then((r) => setOk(r.ok)).catch(() => setOk(false));
    ver();
    const t = setInterval(ver, 30_000);
    window.addEventListener('online', ver);
    window.addEventListener('offline', ver);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', ver);
      window.removeEventListener('offline', ver);
    };
  }, []);
  if (ok === null) return null;
  return (
    <span className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold sm:inline-flex ${ok ? 'text-verde dark:text-emerald-300' : 'bg-vermelho/10 text-vermelho'}`}>
      <span className={`size-2 rounded-full ${ok ? 'bg-verde' : 'bg-vermelho'}`} aria-hidden />
      {ok ? 'Conectado' : 'Sem conexão'}
    </span>
  );
}

type AvisoAtualizacao = { disponivel: boolean; emAndamento: boolean; versao: string | null };
interface Notificacao { id: string; titulo: string; texto: string | null; link: string | null; lida: boolean; criadaEm: string }

/** Sino: aviso de atualização (para todos) e notificações da pessoa. */
function Sino() {
  const { sessao } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState<AvisoAtualizacao | null>(null);
  const [naoLidas, setNaoLidas] = useState(0);
  const [lista, setLista] = useState<Notificacao[] | null>(null);

  useEffect(() => {
    const ver = () => {
      api.get<AvisoAtualizacao>('/api/atualizacao/aviso').then(setAviso).catch(() => {});
      api.get<{ naoLidas: number }>('/api/notificacoes/contagem').then((r) => setNaoLidas(r.naoLidas)).catch(() => {});
    };
    ver();
    const t = setInterval(ver, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const abrir = async () => {
    setAberto((v) => !v);
    if (!aberto) {
      const l = await api.get<Notificacao[]>('/api/notificacoes').catch(() => []);
      setLista(l);
      if (l.some((n) => !n.lida)) {
        await api.post('/api/notificacoes/lidas').catch(() => {});
        setNaoLidas(0);
      }
    }
  };

  const total = naoLidas + (aviso?.disponivel ? 1 : 0);
  return (
    <div className="relative">
      <button onClick={() => void abrir()} className="relative grid size-11 place-items-center rounded-full hover:bg-superficie" aria-label={`Notificações${total ? `: ${total} nova(s)` : ''}`} aria-expanded={aberto}>
        <Bell className="size-5" />
        {total > 0 && <span className="absolute right-2 top-2 grid min-w-4 place-items-center rounded-full bg-vermelho px-1 text-[10px] font-bold text-white">{total}</span>}
      </button>
      {aberto && (
        <div className="absolute right-0 top-12 z-40 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-borda bg-superficie shadow-xl">
          <p className="border-b border-borda px-4 py-3 text-sm font-semibold">Notificações</p>
          <div className="max-h-[60dvh] overflow-y-auto">
            {aviso?.disponivel && (
              <div className="border-b border-borda bg-creme/60 px-4 py-3 text-sm dark:bg-amarelo/10">
                <p className="font-semibold">Nova atualização disponível{aviso.versao ? ` (${aviso.versao})` : ''}</p>
                <p className="text-suave">
                  {aviso.emAndamento ? 'A atualização está sendo aplicada. A tela recarrega sozinha quando terminar.'
                    : sessao?.usuario?.desenvolvedor ? <Link to="/integracao?aba=geral&abrir=atualizacao" className="font-semibold underline" onClick={() => setAberto(false)}>Ver e aplicar</Link>
                    : 'A TI vai aplicar em breve.'}
                </p>
              </div>
            )}
            {lista === null ? (
              <p className="px-4 py-6 text-center text-sm text-suave">Carregando...</p>
            ) : lista.length === 0 && !aviso?.disponivel ? (
              <p className="px-4 py-6 text-center text-sm text-suave">Nenhuma notificação.</p>
            ) : (
              lista.map((n) => (
                <div key={n.id} className="border-b border-borda px-4 py-3 text-sm last:border-0">
                  <p className="font-semibold">{n.titulo}</p>
                  {n.texto && <p className="text-suave">{n.texto}</p>}
                  <p className="mt-1 text-xs text-suave">{relativo(n.criadaEm)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
