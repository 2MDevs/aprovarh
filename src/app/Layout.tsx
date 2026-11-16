import {
  Bell, Building2, CalendarDays, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Menu, MessagesSquare, Monitor, Moon, Plug, QrCode, ScrollText, Server, Settings2, Smartphone, Sun, Tags, UserRound, Users, Workflow, X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
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
  descricao?: string;
  icone: ReactNode;
  /** "principal" fica na barra lateral; "ajustes" fica dentro da tela Configurações (engrenagem). */
  grupo: 'principal' | 'ajustes';
  permissao?: Permissao | Permissao[];
  somenteDesenvolvedor?: boolean;
}

const I = 'size-[22px]';
/** Só aparecem as telas que a pessoa pode usar. A primeira da lista é a tela inicial. */
export const MENU: ItemMenu[] = [
  // Barra lateral
  { grupo: 'principal', rota: '/visao-geral', rotulo: 'Visão geral', icone: <LayoutDashboard className={I} />, permissao: 'dashboard.ver' },
  { grupo: 'principal', rota: '/conversas', rotulo: 'Conversas', icone: <MessagesSquare className={I} />, permissao: 'candidatos.ver' },
  { grupo: 'principal', rota: '/candidatos', rotulo: 'Candidatos', icone: <Users className={I} />, permissao: 'candidatos.ver' },
  { grupo: 'principal', rota: '/entrevistas', rotulo: 'Entrevistas', icone: <CalendarDays className={I} />, permissao: 'candidatos.ver' },
  { grupo: 'principal', rota: '/automacoes', rotulo: 'Automações', icone: <Workflow className={I} />, permissao: 'automacoes.ver' },
  // Dentro de Configurações (engrenagem)
  { grupo: 'ajustes', rota: '/conta', rotulo: 'Minha conta', descricao: 'Senha, PIN de desbloqueio e sessões', icone: <UserRound className={I} /> },
  { grupo: 'ajustes', rota: '/configuracoes', rotulo: 'Status e tags', descricao: 'Etapas do processo seletivo e marcadores dos candidatos', icone: <Tags className={I} />, permissao: 'candidatos.ver' },
  { grupo: 'ajustes', rota: '/conexao', rotulo: 'Conexão do WhatsApp', descricao: 'Conectar o celular pelo QR Code', icone: <QrCode className={I} />, permissao: 'whatsapp.conectar' },
  { grupo: 'ajustes', rota: '/administracao', rotulo: 'Usuários e unidades', descricao: 'Pessoas, perfis, permissões e lojas', icone: <Building2 className={I} />, permissao: ['usuarios.gerenciar', 'unidades.gerenciar'] },
  { grupo: 'ajustes', rota: '/dispositivos', rotulo: 'Dispositivos', descricao: 'Aparelhos que acessaram o sistema', icone: <Smartphone className={I} /> },
  { grupo: 'ajustes', rota: '/auditoria', rotulo: 'Auditoria', descricao: 'Registro de tudo o que foi feito', icone: <ScrollText className={I} />, permissao: 'auditoria.ver' },
  { grupo: 'ajustes', rota: '/sistema', rotulo: 'Sistema', descricao: 'Uso do servidor, API e documentos da plataforma', icone: <Server className={I} />, permissao: 'sistema.ver' },
  { grupo: 'ajustes', rota: '/integracao', rotulo: 'Integração', descricao: 'E-mail, WhatsApp, segurança e atualização do sistema', icone: <Plug className={I} />, somenteDesenvolvedor: true },
];

export function useMenu() {
  const { sessao, pode } = useSessao();
  return MENU.filter((i) => {
    if (i.somenteDesenvolvedor) return Boolean(sessao?.usuario?.desenvolvedor);
    if (!i.permissao) return true;
    return (Array.isArray(i.permissao) ? i.permissao : [i.permissao]).some(pode);
  });
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Tela Configurações (engrenagem): reúne a conta e tudo o que é de administração. */
export function Ajustes() {
  const { sessao, sair } = useSessao();
  const itens = useMenu().filter((i) => i.grupo === 'ajustes');
  const u = sessao!.usuario!;
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
      <Link to="/conta" className="mt-5 flex items-center gap-4 rounded-2xl p-3 hover:bg-superficie">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-grafite text-xl font-bold text-amarelo" aria-hidden>{iniciais(u.nome)}</span>
        <span className="min-w-0">
          <span className="block truncate text-lg font-semibold">{u.nome}</span>
          <span className="block truncate text-sm text-suave">{u.perfil}{u.setor ? ` · ${u.setor}` : ''}</span>
        </span>
      </Link>
      <ul className="mt-3 divide-y divide-borda border-y border-borda">
        {itens.map((i) => (
          <li key={i.rota}>
            <Link to={i.rota} className="flex min-h-16 items-center gap-4 px-3 py-3 hover:bg-superficie">
              <span className="grid size-10 shrink-0 place-items-center text-suave">{i.icone}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{i.rotulo}</span>
                {i.descricao && <span className="block truncate text-sm text-suave">{i.descricao}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-suave" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <button onClick={() => void sair()} className="mt-3 flex min-h-14 w-full items-center gap-4 rounded-2xl px-3 font-medium text-vermelho hover:bg-vermelho/10">
        <span className="grid size-10 place-items-center"><LogOut className={I} /></span> Sair
      </button>
    </div>
  );
}

/** Botão redondo da barra lateral: só o ícone, com o nome ao passar o mouse. */
function BotaoBarra({ rota, rotulo, ativo, children }: { rota: string; rotulo: string; ativo: boolean; children: ReactNode }) {
  return (
    <Link to={rota} aria-label={rotulo} aria-current={ativo ? 'page' : undefined}
      className={`group relative grid size-11 place-items-center rounded-full transition ${ativo ? 'bg-amarelo text-grafite' : 'text-creme/70 hover:bg-white/10 hover:text-creme'}`}>
      {children}
      <span role="tooltip" className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-lg bg-grafite px-2.5 py-1.5 text-xs font-medium text-creme shadow-lg ring-1 ring-white/15 group-hover:block group-focus-visible:block">
        {rotulo}
      </span>
    </Link>
  );
}

export function Layout() {
  const { sessao, sair, pode } = useSessao();
  const menu = useMenu();
  const principal = menu.filter((i) => i.grupo === 'principal');
  const ajustes = menu.filter((i) => i.grupo === 'ajustes');
  const [aberto, setAberto] = useState(false);
  const local = useLocation();
  useEffect(() => setAberto(false), [local.pathname]);
  const u = sessao!.usuario!;
  const em = (rota: string) => local.pathname === rota || local.pathname.startsWith(`${rota}/`);
  const emConta = em('/conta');
  const emAjustes = em('/ajustes') || (!emConta && ajustes.some((i) => em(i.rota)));
  const subAjuste = ajustes.find((i) => em(i.rota));
  // Conversas ocupa a altura toda da tela (lista, conversa e perfil com rolagem própria).
  const telaCheia = em('/conversas') || /^\/automacoes\/[^/]+/.test(local.pathname); // conversa e construtor ocupam a tela toda

  // Formulário público fechado: a equipe vê o motivo (o candidato só vê "indisponível").
  const [formulario, setFormulario] = useState<{ aberto: boolean; falta: string[] } | null>(null);
  const veCandidatos = pode('candidatos.ver');
  useEffect(() => {
    if (veCandidatos) api.get<{ aberto: boolean; falta: string[] }>('/api/formulario-situacao').then(setFormulario).catch(() => {});
  }, [veCandidatos, local.pathname]);

  return (
    <div className="min-h-dvh lg:pl-[68px]">
      {/* Barra lateral fina (computador): só ícones; engrenagem e perfil embaixo. */}
      <nav aria-label="Menu principal" className="fixed inset-y-0 left-0 z-40 hidden w-[68px] flex-col items-center bg-grafite py-3 lg:flex">
        <Link to="/" aria-label="aprovaRH - Hummm! Pizzas: início" className="mb-3 grid size-11 place-items-center rounded-xl bg-amarelo text-[13px] font-extrabold tracking-tight text-grafite">RH</Link>
        <div className="flex flex-1 flex-col items-center gap-1.5">
          {principal.map((i) => <BotaoBarra key={i.rota} rota={i.rota} rotulo={i.rotulo} ativo={em(i.rota)}>{i.icone}</BotaoBarra>)}
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <BotaoBarra rota="/ajustes" rotulo="Configurações" ativo={emAjustes}><Settings2 className={I} /></BotaoBarra>
          <Link to="/conta" aria-label={`Minha conta: ${u.nome}`} title={u.nome}
            className={`grid size-11 place-items-center rounded-full text-sm font-bold transition ${emConta ? 'bg-amarelo text-grafite' : 'bg-white/12 text-creme hover:bg-white/20'}`}>
            {iniciais(u.nome)}
          </Link>
        </div>
      </nav>

      {/* Celular: gaveta com os nomes. */}
      {aberto && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-grafite/50" onClick={() => setAberto(false)} />
          <nav aria-label="Menu principal" className="absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col bg-grafite text-creme shadow-2xl">
            <div className="flex flex-col gap-3 px-6 pb-5 pt-[max(1.5rem,env(safe-area-inset-top))]">
              <LogoHummm fundo="escuro" className="h-9 self-start" />
              <NomePlataforma escuro className="text-xl" />
            </div>
            <ul className="flex-1 space-y-1 overflow-y-auto px-3">
              {[...principal, { rota: '/ajustes', rotulo: 'Configurações', icone: <Settings2 className={I} /> }].map((i) => {
                const ativo = i.rota === '/ajustes' ? emAjustes : em(i.rota);
                return (
                  <li key={i.rota}>
                    <Link to={i.rota} aria-current={ativo ? 'page' : undefined}
                      className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-medium ${ativo ? 'bg-amarelo text-grafite' : 'text-creme/80 hover:bg-white/8'}`}>
                      {i.icone} {i.rotulo}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-white/10 p-3">
              <Link to="/conta" className="flex items-center gap-3 rounded-xl p-2 hover:bg-white/8">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/12 text-sm font-bold" aria-hidden>{iniciais(u.nome)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{u.nome}</span>
                  <span className="block truncate text-xs text-creme/60">{u.perfil}{u.setor ? ` · ${u.setor}` : ''}</span>
                </span>
              </Link>
              <button onClick={() => void sair()} className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-creme/80 hover:bg-white/8">
                <LogOut className="size-5" /> Sair
              </button>
            </div>
            <div className="faixa-marca h-1 shrink-0" aria-hidden />
          </nav>
        </div>
      )}

      <div className={`flex min-w-0 flex-col ${telaCheia ? 'h-dvh' : 'min-h-dvh'}`}>
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-borda bg-fundo/90 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur lg:px-6">
          <button className="grid size-11 place-items-center rounded-full hover:bg-superficie lg:hidden" onClick={() => setAberto(true)} aria-label="Abrir menu">
            {aberto ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link to="/" className="flex items-baseline gap-2">
            <NomePlataforma className="text-lg" />
            <span className="hidden text-sm font-medium text-suave sm:inline">Hummm! Pizzas</span>
          </Link>
          <div className="flex-1" />
          <IndicadorConexao />
          <BotaoTema />
          <Sino />
        </header>

        {sessao?.modoConfiguracao && u.desenvolvedor && (
          <div className="border-b border-amarelo bg-amarelo/25 px-4 py-2.5 text-sm lg:px-6">
            <strong>Configuração inicial pendente.</strong> O e-mail (SMTP) ainda não foi configurado, por isso o 2FA está desligado.{' '}
            <Link to="/integracao?aba=integracoes&abrir=smtp" className="font-semibold underline">Configurar agora</Link>
          </div>
        )}
        {formulario && !formulario.aberto && (
          <div className="border-b border-vermelho/40 bg-vermelho/10 px-4 py-2.5 text-sm lg:px-6" role="status">
            <strong>O formulário de candidatura está fechado para os candidatos.</strong>{' '}
            {formulario.falta.includes('aviso') && <>Falta publicar o aviso de privacidade (LGPD). {u.desenvolvedor
              ? <Link to="/integracao?aba=geral&abrir=privacidade" className="font-semibold underline">Publicar agora</Link>
              : 'Peça à TI para publicar em Integração.'}{' '}</>}
            {formulario.falta.includes('unidade') && <>Falta uma unidade ativa recebendo candidaturas (Configurações › Usuários e unidades).</>}
          </div>
        )}

        <main className={telaCheia ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8 lg:py-8'}>
          {subAjuste && (
            <Link to="/ajustes" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-suave hover:text-texto">
              <ChevronLeft className="size-4" /> Configurações
            </Link>
          )}
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
