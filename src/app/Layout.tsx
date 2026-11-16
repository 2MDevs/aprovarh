import {
  Bell, Building2, LayoutDashboard, CalendarDays, LogOut, Menu, MessagesSquare, Monitor, Moon, Pin, PinOff, Plug, ScrollText, Server, Settings2, Smartphone, Sun, UserRound, Users, Workflow, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import type { Permissao } from '@shared/permissoes';
import { LogoHummm, NomePlataforma } from '../components/Marca';
import { api } from '../lib/api';
import { useEventos } from '../lib/eventos';
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

/** Só aparecem as telas que a pessoa pode usar. A primeira da lista é a tela inicial. */
export const MENU: ItemMenu[] = [
  // Central de RH
  { rota: '/visao-geral', rotulo: 'Visão geral', icone: <LayoutDashboard className="size-5" />, permissao: 'dashboard.ver' },
  { rota: '/conversas', rotulo: 'Conversas', icone: <MessagesSquare className="size-5" />, permissao: 'candidatos.ver' },
  { rota: '/candidatos', rotulo: 'Candidatos', icone: <Users className="size-5" />, permissao: 'candidatos.ver' },
  { rota: '/entrevistas', rotulo: 'Entrevistas', icone: <CalendarDays className="size-5" />, permissao: 'candidatos.ver' },
  { rota: '/automacoes', rotulo: 'Automações', icone: <Workflow className="size-5" />, permissao: 'automacoes.ver' },
  { rota: '/configuracoes', rotulo: 'Configurações', icone: <Settings2 className="size-5" />, permissao: 'candidatos.ver' },
  // Administração
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

/** Trava do menu lateral: fica salva neste navegador. */
const CHAVE_TRAVA = 'aprovarh.menuTravado';
function lerTrava() {
  try { return localStorage.getItem(CHAVE_TRAVA) === '1'; } catch { return false; }
}
function salvarTrava(v: boolean) {
  try { localStorage.setItem(CHAVE_TRAVA, v ? '1' : '0'); } catch { /* navegador sem armazenamento: vale só nesta visita */ }
}

const LARGURA_ABERTO = 'w-[264px]';
const LARGURA_FECHADO = 'w-[76px]';

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/**
 * Menu lateral. No computador ele fica recolhido (só os ícones), abre quando o mouse passa por cima
 * e pode ser travado aberto pelo botão de trava. No celular abre sempre inteiro, como gaveta.
 */
function Lateral({ compacto, travado, onTravar }: { compacto: boolean; travado?: boolean; onTravar?: () => void }) {
  const { sessao, sair } = useSessao();
  const menu = useMenu();
  const u = sessao!.usuario!;
  const rotulo = `whitespace-nowrap transition-opacity duration-150 ${compacto ? 'pointer-events-none opacity-0' : 'opacity-100'}`;
  return (
    <nav aria-label="Menu principal" className="flex h-full flex-col overflow-hidden bg-grafite text-creme">
      <div className="flex min-h-[104px] items-start gap-2 px-4 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))]">
        {compacto ? (
          <span className="mx-auto mt-1 grid size-11 shrink-0 place-items-center rounded-xl bg-amarelo text-sm font-bold text-grafite" aria-label="aprovaRH">RH</span>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-3 pl-2">
              <LogoHummm fundo="escuro" className="h-9 self-start" />
              <NomePlataforma escuro className="whitespace-nowrap text-xl" />
            </div>
            {onTravar && (
              <button
                type="button"
                onClick={onTravar}
                aria-pressed={travado}
                aria-label={travado ? 'Destravar o menu (volta a recolher)' : 'Travar o menu aberto'}
                title={travado ? 'Destravar o menu' : 'Travar o menu aberto'}
                className={`grid size-9 shrink-0 place-items-center rounded-lg transition ${travado ? 'bg-amarelo text-grafite' : 'text-creme/60 hover:bg-white/10 hover:text-creme'}`}
              >
                {travado ? <PinOff className="size-4" /> : <Pin className="size-4" />}
              </button>
            )}
          </>
        )}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3">
        {menu.map((i) => (
          <li key={i.rota}>
            <NavLink
              to={i.rota}
              title={compacto ? i.rotulo : undefined}
              aria-label={compacto ? i.rotulo : undefined}
              className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-xl px-4 text-[15px] font-medium transition
                ${isActive ? 'bg-amarelo text-grafite' : 'text-creme/75 hover:bg-white/8 hover:text-creme'}`}
            >
              <span className="shrink-0">{i.icone}</span>
              <span className={rotulo}>{i.rotulo}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 px-3 py-4">
        <div className="flex items-center gap-3 px-1" title={compacto ? u.nome : undefined}>
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold" aria-hidden>{iniciais(u.nome)}</span>
          <div className={`min-w-0 ${rotulo}`}>
            <p className="truncate text-sm font-semibold">{u.nome}</p>
            <p className="truncate text-xs text-creme/60">{u.perfil}{u.setor ? ` · ${u.setor}` : ''}</p>
          </div>
        </div>
        <button
          onClick={() => void sair()}
          title={compacto ? 'Sair' : undefined}
          aria-label="Sair"
          className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-creme/75 hover:bg-white/8 hover:text-creme"
        >
          <LogOut className="size-5 shrink-0" /> <span className={rotulo}>Sair</span>
        </button>
      </div>
      <div className="faixa-marca h-1 shrink-0" aria-hidden />
    </nav>
  );
}

export function Layout() {
  const { sessao } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [travado, setTravado] = useState(lerTrava);
  const [passando, setPassando] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const local = useLocation();
  useEffect(() => setAberto(false), [local.pathname]);
  useEffect(() => () => { if (espera.current) clearTimeout(espera.current); }, []);
  const u = sessao!.usuario!;
  // Conversas ocupa a altura toda da tela (lista, conversa e perfil com rolagem própria).
  const telaCheia = local.pathname.startsWith('/conversas') || /^\/automacoes\/[^/]+/.test(local.pathname); // conversa e construtor ocupam a tela toda

  // Um pequeno atraso evita abrir o menu só de cruzar o mouse por cima dele.
  const passar = (v: boolean) => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => setPassando(v), v ? 120 : 180);
  };
  const expandido = travado || passando;
  const travar = () => {
    const v = !travado;
    setTravado(v);
    salvarTrava(v);
    if (!v) setPassando(true); // destravou com o mouse em cima: continua aberto até o mouse sair
  };

  return (
    <div className="min-h-dvh lg:flex">
      {/* Reserva o espaço do menu; quando ele abre pelo mouse, passa por cima da tela sem empurrar nada. */}
      <div className={`hidden shrink-0 transition-[width] duration-200 lg:block ${travado ? LARGURA_ABERTO : LARGURA_FECHADO}`} aria-hidden />
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden h-dvh transition-[width,box-shadow] duration-200 lg:block ${expandido ? LARGURA_ABERTO : LARGURA_FECHADO} ${expandido && !travado ? 'shadow-2xl shadow-black/30' : ''}`}
        onMouseEnter={() => passar(true)}
        onMouseLeave={() => passar(false)}
        onFocus={() => { if (espera.current) clearTimeout(espera.current); setPassando(true); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) passar(false); }}
      >
        <Lateral compacto={!expandido} travado={travado} onTravar={travar} />
      </aside>

      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-grafite/50" onClick={() => setAberto(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-[300px] shadow-2xl"><Lateral compacto={false} /></div>
        </div>
      )}

      <div className={`flex min-w-0 flex-col lg:flex-1 ${telaCheia ? 'h-dvh' : ''}`}>
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

        <main className={telaCheia ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:py-8'}>
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
  const { pode } = useSessao();

  // Candidatura nova chega na hora (o aviso do sino é gravado na mesma transação).
  useEventos((tipo) => {
    if (tipo === 'candidatura.nova') api.get<{ naoLidas: number }>('/api/notificacoes/contagem').then((r) => setNaoLidas(r.naoLidas)).catch(() => {});
  }, pode('candidatos.ver'));

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
