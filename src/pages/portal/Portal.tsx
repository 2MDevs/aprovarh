import { CalendarCheck, Check, Circle, Clock, Download, FileText, Loader2, LogOut, Paperclip, Send, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { LogoHummm } from '../../components/Marca';
import { Aviso } from '../../components/ui';
import { bytes } from '../../lib/formato';

type Situacao = 'concluida' | 'em_andamento' | 'aguardando' | 'nao_iniciada';
interface SessaoPortal {
  nome: string; expiraEm: string; podeEnviarArquivo: boolean;
  entrevista: { inicioEm: string; duracaoMinutos: number; confirmada: boolean; remarcando: boolean; unidade: string; local: string | null } | null; etapas: { etapa: string; situacao: Situacao; atualizadoEm: string | null }[] }
interface MensagemPortal { id: string; deMim: boolean; autor: string; texto: string | null; em: string; arquivo: { id: string; nome: string; tamanho: number } | null }

const ROTULO: Record<string, string> = { candidatura: 'Candidatura enviada', analise: 'Análise do currículo', entrevista: 'Entrevista', resultado: 'Resultado' };
const SITUACAO: Record<Situacao, string> = { concluida: 'Concluída', em_andamento: 'Em andamento', aguardando: 'Aguardando', nao_iniciada: 'Não iniciada' };
const FUSO = { timeZone: 'America/Sao_Paulo' } as const;

class Expirou extends Error {}
async function chamar<T>(url: string, opcoes?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', ...opcoes });
  if (r.status === 401) throw new Expirou();
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.erro || 'Algo deu errado. Tente de novo.');
  return j as T;
}

/** Portal do candidato: linha do tempo + conversa com o RH. Nada de lista de contatos nem informação interna. */
export function Portal() {
  const [sessao, setSessao] = useState<SessaoPortal | null>(null);
  const [expirou, setExpirou] = useState(false);
  const [msgs, setMsgs] = useState<MensagemPortal[]>([]);
  const [etapasAbertas, setEtapasAbertas] = useState(false);

  const atualizar = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([chamar<SessaoPortal>('/api/portal/sessao'), chamar<MensagemPortal[]>('/api/portal/mensagens')]);
      setSessao(s);
      setMsgs(m);
    } catch (e) {
      if (e instanceof Expirou) setExpirou(true);
    }
  }, []);

  // Atualiza a cada 10 segundos e quando a pessoa volta para a aba.
  useEffect(() => {
    void atualizar();
    const t = setInterval(() => document.visibilityState === 'visible' && void atualizar(), 10_000);
    const voltar = () => document.visibilityState === 'visible' && void atualizar();
    document.addEventListener('visibilitychange', voltar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', voltar);
    };
  }, [atualizar]);

  // Às 23:59:59 o acesso termina sozinho, mesmo com a tela aberta.
  useEffect(() => {
    if (!sessao) return;
    const falta = new Date(sessao.expiraEm).getTime() - Date.now();
    const t = setTimeout(() => setExpirou(true), Math.max(0, Math.min(falta, 2_147_000_000)));
    return () => clearTimeout(t);
  }, [sessao]);

  const sair = async () => {
    await fetch('/api/portal/sair', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setExpirou(true);
  };

  if (expirou) return <AcessoEncerrado />;
  if (!sessao) return <p className="flex min-h-dvh items-center justify-center gap-2 text-suave"><Loader2 className="size-5 animate-spin" /> Carregando...</p>;

  const atual = sessao.etapas.find((e) => e.situacao === 'em_andamento' || e.situacao === 'aguardando') ?? sessao.etapas[sessao.etapas.length - 1];

  return (
    <div className="flex h-dvh flex-col bg-fundo">
      <header className="flex items-center gap-3 bg-grafite px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-creme">
        <LogoHummm fundo="escuro" className="h-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Olá, {sessao.nome}!</p>
          <p className="flex items-center gap-1 text-xs text-creme/70"><Clock className="size-3" /> Acesso válido até {new Date(sessao.expiraEm).toLocaleTimeString('pt-BR', { ...FUSO, hour: '2-digit', minute: '2-digit' })} de hoje</p>
        </div>
        <button onClick={() => void sair()} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-creme/80 hover:bg-white/10"><LogOut className="size-4" /> Sair</button>
      </header>
      <div className="faixa-marca h-1" aria-hidden />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Linha do tempo: no lugar onde a gestora tem a lista de contatos */}
        <aside className="border-b border-borda bg-superficie md:w-80 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r" aria-label="Etapas do seu processo seletivo">
          <button className="flex w-full items-center justify-between px-4 py-3 text-left md:hidden" onClick={() => setEtapasAbertas((v) => !v)} aria-expanded={etapasAbertas}>
            <span><span className="block text-xs text-suave">Etapa atual</span><span className="font-semibold">{ROTULO[atual.etapa]}: {SITUACAO[atual.situacao]}</span></span>
            <span className="text-sm font-semibold text-suave">{etapasAbertas ? 'Fechar' : 'Ver etapas'}</span>
          </button>
          <div className={`${etapasAbertas ? 'block' : 'hidden'} px-5 pb-5 md:block md:pt-6`}>
            <h2 className="mb-5 hidden text-lg font-bold md:block">Seu processo seletivo</h2>
            <ol className="relative">
              {sessao.etapas.map((e, i) => (
                <li key={e.etapa} className="relative flex gap-4 pb-7 last:pb-0">
                  {i < sessao.etapas.length - 1 && <span className={`absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5 ${e.situacao === 'concluida' ? 'bg-verde' : 'bg-borda'}`} aria-hidden />}
                  <IconeEtapa situacao={e.situacao} />
                  <div className="pt-1">
                    <p className="font-semibold">{ROTULO[e.etapa]}</p>
                    <p className={`text-sm ${e.situacao === 'nao_iniciada' ? 'text-suave' : e.situacao === 'concluida' ? 'text-verde dark:text-emerald-300' : 'font-semibold text-amarelo-forte'}`}>{SITUACAO[e.situacao]}</p>
                  </div>
                </li>
              ))}
            </ol>
            {sessao.entrevista && (
              <div className="mt-6 rounded-2xl border border-amarelo bg-creme p-4 text-grafite dark:bg-amarelo/10 dark:text-creme">
                <p className="flex items-center gap-2 text-sm font-bold"><CalendarCheck className="size-4" /> Sua entrevista</p>
                <p className="mt-2 font-semibold capitalize">{new Date(sessao.entrevista.inicioEm).toLocaleDateString('pt-BR', { ...FUSO, weekday: 'long', day: '2-digit', month: 'long' })}</p>
                <p className="text-2xl font-bold">{new Date(sessao.entrevista.inicioEm).toLocaleTimeString('pt-BR', { ...FUSO, hour: '2-digit', minute: '2-digit' })}</p>
                <p className="mt-1 text-sm">Unidade {sessao.entrevista.unidade}{sessao.entrevista.local ? ` · ${sessao.entrevista.local}` : ''}</p>
                <p className="mt-2 text-sm font-semibold">{sessao.entrevista.confirmada ? '✓ Confirmada' : sessao.entrevista.remarcando ? 'Você pediu outra data. A equipe vai propor um novo horário.' : 'Aguardando sua confirmação'}</p>
              </div>
            )}
          </div>
        </aside>

        {/* Conversa com o RH (mesmo histórico da Central) */}
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Conversa com o RH">
          <ChatPortal msgs={msgs} podeEnviarArquivo={sessao.podeEnviarArquivo} onEnviada={() => void atualizar()} onExpirou={() => setExpirou(true)} />
        </section>
      </div>
    </div>
  );
}

function IconeEtapa({ situacao }: { situacao: Situacao }) {
  if (situacao === 'concluida') return <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-verde text-white"><Check className="size-4" /></span>;
  if (situacao === 'nao_iniciada') return <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full border-2 border-borda bg-superficie text-borda"><Circle className="size-3" /></span>;
  return <span className="z-10 grid size-8 shrink-0 place-items-center rounded-full bg-amarelo text-grafite ring-4 ring-amarelo/30"><Clock className="size-4" /></span>;
}

function ChatPortal({ msgs, podeEnviarArquivo, onEnviada, onExpirou }: { msgs: MensagemPortal[]; podeEnviarArquivo: boolean; onEnviada: () => void; onExpirou: () => void }) {
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const qtd = useRef(0);

  useLayoutEffect(() => {
    if (msgs.length !== qtd.current) fim.current?.scrollIntoView({ block: 'end' });
    qtd.current = msgs.length;
  }, [msgs]);

  const enviar = async () => {
    if (enviando || (!texto.trim() && !arquivo)) return;
    setErro('');
    setEnviando(true);
    try {
      if (arquivo) {
        const dados = new FormData();
        dados.set('arquivo', arquivo);
        await chamar('/api/portal/mensagens/arquivo', { method: 'POST', body: dados });
        setArquivo(null);
      }
      if (texto.trim()) {
        await chamar('/api/portal/mensagens', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: texto.trim() }) });
        setTexto('');
      }
      onEnviada();
    } catch (e) {
      if (e instanceof Expirou) return onExpirou();
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6" role="log" aria-live="polite">
        {!msgs.length && (
          <p className="mx-auto max-w-sm py-10 text-center text-sm text-suave">Aqui você conversa com a equipe de RH da Hummm! Pizzas. Escreva se tiver alguma dúvida sobre o seu processo.</p>
        )}
        <ol className="space-y-2">
          {msgs.map((m) => (
            <li key={m.id} className={`flex ${m.deMim ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[70%] ${m.deMim ? 'rounded-br-md bg-[#FFF2B8] text-grafite dark:bg-[#4A4020] dark:text-creme' : 'rounded-bl-md bg-superficie'}`}>
                {!m.deMim && <p className="mb-0.5 text-[11px] font-semibold text-suave">{m.autor}</p>}
                {m.arquivo && (
                  <a href={`/api/portal/arquivos/${m.arquivo.id}`} className="mb-1 flex items-center gap-2 rounded-xl bg-black/5 p-2.5 dark:bg-white/5">
                    <FileText className="size-7 shrink-0 text-suave" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{m.arquivo.nome}</span><span className="text-xs text-suave">{bytes(m.arquivo.tamanho)}</span></span>
                    <Download className="size-4" aria-label="Baixar" />
                  </a>
                )}
                {m.texto && <p className="whitespace-pre-wrap break-words text-[15px]">{m.texto}</p>}
                <p className="mt-0.5 text-right text-[11px] text-suave">
                  {new Date(m.em).toLocaleString('pt-BR', { ...FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div ref={fim} />
      </div>
      <div className="border-t border-borda bg-superficie px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {erro && <div className="mb-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        {arquivo && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-superficie-2 px-3 py-2 text-sm">
            <Paperclip className="size-4 text-suave" /><span className="flex-1 truncate">{arquivo.name}</span>
            <button onClick={() => setArquivo(null)} className="grid size-8 place-items-center rounded-full" aria-label="Tirar arquivo"><X className="size-4" /></button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {podeEnviarArquivo && (
            <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-superficie-2" title="Enviar arquivo">
              <Paperclip className="size-5" /><span className="sr-only">Enviar arquivo</span>
              <input type="file" className="sr-only" accept=".pdf,.doc,.docx,image/jpeg,image/png" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
          )}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={teclas} rows={1} maxLength={2000} placeholder="Escreva uma mensagem" aria-label="Mensagem"
            className="campo max-h-32 min-h-11 flex-1 resize-none !rounded-2xl !py-2.5" />
          <button onClick={() => void enviar()} disabled={enviando || (!texto.trim() && !arquivo)} aria-label="Enviar"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-destaque text-destaque-texto disabled:opacity-40">
            {enviando ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </button>
        </div>
      </div>
    </>
  );
}

function AcessoEncerrado() {
  return (
    <div className="flex min-h-dvh flex-col bg-fundo">
      <header className="bg-grafite px-5 pb-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-center"><LogoHummm fundo="escuro" className="mx-auto h-12" /></header>
      <div className="faixa-marca h-1.5" aria-hidden />
      <main className="flex flex-1 items-start justify-center px-5 py-12 sm:items-center">
        <div className="cartao max-w-sm p-8 text-center">
          <Clock className="mx-auto size-12 text-amarelo-forte" />
          <h1 className="mt-4 text-xl font-bold">Seu acesso terminou</h1>
          <p className="mt-2 text-[15px] text-suave">O código vale só até o fim do dia em que foi enviado. Suas mensagens continuam guardadas. Quando houver novidade no seu processo, você recebe um código novo pelo WhatsApp.</p>
          <Link to="/acesso" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-borda bg-superficie px-5 text-sm font-semibold hover:bg-superficie-2">Tenho um código novo</Link>
        </div>
      </main>
    </div>
  );
}
