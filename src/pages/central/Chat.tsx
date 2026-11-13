import { ArrowLeft, Bot, Check, CheckCheck, Download, EyeOff, FileText, Info, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSessao } from '../../app/sessao';
import { Aviso, useAviso } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { bytes } from '../../lib/formato';
import { useDados } from '../../lib/useDados';
import { Foto, Pilula } from './comum';
import { urlArquivo, type Mensagem, type Perfil } from './tipos';

const FUSO = { timeZone: 'America/Sao_Paulo' } as const;
const diaDe = (v: string) => new Date(v).toLocaleDateString('pt-BR', { ...FUSO, weekday: 'long', day: '2-digit', month: 'long' });
const hora = (v: string) => new Date(v).toLocaleTimeString('pt-BR', { ...FUSO, hour: '2-digit', minute: '2-digit' });

interface PaginaMensagens { temMais: boolean; lidaAte: string | null; mensagens: Mensagem[] }

export function Chat({ candidatoId, versao, onVoltar, onAbrirPerfil, onLida }: {
  candidatoId: string; versao: number; onVoltar: () => void; onAbrirPerfil: () => void; onLida: () => void;
}) {
  const { pode } = useSessao();
  const perfil = useDados<Perfil>(`/api/central/candidatos/${candidatoId}`);
  const [msgs, setMsgs] = useState<Mensagem[]>([]);
  const [temMais, setTemMais] = useState(false);
  const [lidaAte, setLidaAte] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const primeiraCarga = useRef(true);

  const marcarLida = useCallback(async () => {
    await api.post(`/api/central/candidatos/${candidatoId}/lida`).catch(() => {});
    onLida();
  }, [candidatoId, onLida]);

  // Últimas mensagens (na abertura e a cada aviso em tempo real).
  const carregarRecentes = useCallback(async () => {
    try {
      const r = await api.get<PaginaMensagens>(`/api/central/candidatos/${candidatoId}/mensagens?limite=50`);
      setMsgs((atual) => {
        const ids = new Set(r.mensagens.map((m) => m.id));
        const antigas = atual.filter((m) => !ids.has(m.id) && (!r.mensagens.length || m.em < r.mensagens[r.mensagens.length - 1].em));
        return [...antigas, ...[...r.mensagens].reverse()];
      });
      if (primeiraCarga.current) {
        setTemMais(r.temMais);
        setLidaAte(r.lidaAte);
      }
      setErro('');
      void marcarLida();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Não foi possível carregar a conversa.');
    } finally {
      setCarregando(false);
    }
  }, [candidatoId, marcarLida]);

  useEffect(() => {
    void carregarRecentes();
  }, [carregarRecentes, versao]);

  // Rola para o fim na primeira carga e quando chega mensagem nova (se a pessoa já estava perto do fim).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !msgs.length) return;
    const pertoDoFim = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (primeiraCarga.current || pertoDoFim) {
      fim.current?.scrollIntoView({ block: 'end' });
      primeiraCarga.current = false;
    }
  }, [msgs]);

  const carregarAntigas = async () => {
    if (!msgs.length) return;
    const el = area.current;
    const alturaAntes = el?.scrollHeight ?? 0;
    const r = await api.get<PaginaMensagens>(`/api/central/candidatos/${candidatoId}/mensagens?limite=50&antes=${encodeURIComponent(msgs[0].em)}`);
    setTemMais(r.temMais);
    setMsgs((atual) => [...[...r.mensagens].reverse(), ...atual]);
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - alturaAntes));
  };

  const p = perfil.dados;
  const nome = p ? `${p.nome} ${p.sobrenome}` : '';

  return (
    <>
      <header className="flex items-center gap-3 border-b border-borda bg-superficie px-3 py-2.5">
        <button onClick={onVoltar} className="grid size-11 place-items-center rounded-full hover:bg-superficie-2 md:hidden" aria-label="Voltar para a lista"><ArrowLeft className="size-5" /></button>
        {p ? (
          <button onClick={onAbrirPerfil} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left" aria-label="Abrir perfil do candidato">
            <Foto candidatoId={candidatoId} fotoId={p.fotoId} nome={nome} tamanho={42} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{nome}</span>
              <span className="block truncate text-xs text-suave">{p.codigo} · {p.unidade.nome} · {p.telefone}</span>
            </span>
          </button>
        ) : <span className="flex-1" />}
        {p && <span className="hidden sm:block"><Pilula cor={p.status.cor}>{p.status.nome}</Pilula></span>}
        <button onClick={onAbrirPerfil} className="grid size-11 place-items-center rounded-full hover:bg-superficie-2" aria-label="Perfil do candidato" title="Perfil do candidato"><Info className="size-5" /></button>
      </header>

      <div ref={area} className="flex-1 overflow-y-auto px-3 py-4 sm:px-8" role="log" aria-live="polite" aria-label="Mensagens">
        {carregando ? <p className="flex justify-center py-10 text-suave"><Loader2 className="size-5 animate-spin" /></p> : erro ? <Aviso tipo="erro">{erro}</Aviso> : (
          <>
            {temMais && (
              <div className="mb-4 text-center">
                <button onClick={() => void carregarAntigas()} className="rounded-full border border-borda bg-superficie px-4 py-2 text-xs font-semibold hover:bg-superficie-2">Ver mensagens anteriores</button>
              </div>
            )}
            {!msgs.length && <p className="py-10 text-center text-sm text-suave">Nenhuma mensagem ainda.</p>}
            <ol className="space-y-1.5">
              {msgs.map((m, i) => {
                const novoDia = i === 0 || diaDe(msgs[i - 1].em) !== diaDe(m.em);
                const primeiraNaoLida = lidaAte && m.sentido === 'entrada' && m.em > lidaAte && (i === 0 || msgs[i - 1].em <= lidaAte);
                return (
                  <li key={m.id}>
                    {novoDia && <p className="my-3 text-center"><span className="rounded-full bg-superficie px-3 py-1 text-xs font-medium text-suave shadow-sm">{diaDe(m.em)}</span></p>}
                    {primeiraNaoLida && <p className="my-3 text-center text-xs font-bold uppercase tracking-wide text-verde">Mensagens novas</p>}
                    <Balao m={m} candidatoId={candidatoId} podeBaixar={pode('candidatos.curriculo.baixar')} />
                  </li>
                );
              })}
            </ol>
            <div ref={fim} />
          </>
        )}
      </div>

      {pode('conversas.responder') ? (
        <Escrever candidatoId={candidatoId} onEnviada={() => void carregarRecentes()} />
      ) : (
        <p className="border-t border-borda bg-superficie px-4 py-3 text-center text-sm text-suave">Você pode ler a conversa, mas não responder.</p>
      )}
    </>
  );
}

function Balao({ m, candidatoId, podeBaixar }: { m: Mensagem; candidatoId: string; podeBaixar: boolean }) {
  if (m.canal === 'sistema' || m.autorTipo === 'sistema') {
    return (
      <p className="my-2 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-creme px-3 py-1.5 text-xs text-grafite dark:bg-amarelo/10 dark:text-creme">
          {!m.visivelAoCandidato && <EyeOff className="size-3.5" aria-label="Não aparece para o candidato" />}
          {m.texto} · {hora(m.em)}
        </span>
      </p>
    );
  }
  const minha = m.sentido === 'saida';
  const chatbot = m.autorTipo === 'chatbot';
  return (
    <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[70%] ${minha ? 'rounded-br-md bg-[#FFF2B8] text-grafite dark:bg-[#4A4020] dark:text-creme' : 'rounded-bl-md bg-superficie'}`}>
        {(chatbot || (minha && m.autorNome)) && (
          <p className={`mb-0.5 flex items-center gap-1 text-[11px] font-semibold ${chatbot ? 'text-[#6D4FD8] dark:text-violet-300' : 'text-suave'}`}>
            {chatbot && <Bot className="size-3.5" aria-hidden />}{chatbot ? 'Chatbot' : m.autorNome}
          </p>
        )}
        {m.arquivo && <Anexo arquivo={m.arquivo} candidatoId={candidatoId} podeBaixar={podeBaixar} />}
        {m.texto && <p className="whitespace-pre-wrap break-words text-[15px]">{m.texto}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-suave">
          {m.canal === 'whatsapp' && <span className="font-semibold">WhatsApp ·</span>}
          {hora(m.em)}
          {minha && m.situacaoEntrega === 'lida' && <CheckCheck className="size-3.5 text-sky-600" aria-label="Lida" />}
          {minha && m.situacaoEntrega === 'entregue' && <CheckCheck className="size-3.5" aria-label="Entregue" />}
          {minha && m.situacaoEntrega === 'enviada' && <Check className="size-3.5" aria-label="Enviada" />}
          {minha && m.situacaoEntrega === 'falhou' && <span className="font-semibold text-vermelho">Falhou</span>}
        </p>
      </div>
    </div>
  );
}

function Anexo({ arquivo, candidatoId, podeBaixar }: { arquivo: NonNullable<Mensagem['arquivo']>; candidatoId: string; podeBaixar: boolean }) {
  return (
    <div className="mb-1 flex items-center gap-3 rounded-xl bg-black/5 p-2.5 dark:bg-white/5">
      <FileText className="size-8 shrink-0 text-suave" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{arquivo.nome}</span>
        <span className="text-xs text-suave">{bytes(arquivo.tamanho)}</span>
      </span>
      {podeBaixar && (
        <>
          <a href={urlArquivo(candidatoId, arquivo.id)} target="_blank" rel="noreferrer" className="rounded-full px-2 py-1 text-xs font-semibold hover:bg-black/5">Abrir</a>
          <a href={urlArquivo(candidatoId, arquivo.id, 'baixar')} className="grid size-9 place-items-center rounded-full hover:bg-black/5" aria-label="Baixar"><Download className="size-4" /></a>
        </>
      )}
    </div>
  );
}

function Escrever({ candidatoId, onEnviada }: { candidatoId: string; onEnviada: () => void }) {
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const avisar = useAviso();
  const campo = useRef<HTMLTextAreaElement>(null);

  // A caixa cresce com o texto (até 6 linhas).
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  const enviar = async () => {
    if (enviando || (!texto.trim() && !arquivo)) return;
    setEnviando(true);
    try {
      if (arquivo) {
        const dados = new FormData();
        if (texto.trim()) dados.set('legenda', texto.trim());
        dados.set('arquivo', arquivo);
        const r = await fetch(`/api/central/candidatos/${candidatoId}/mensagens/arquivo`, { method: 'POST', body: dados, credentials: 'same-origin' });
        if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => null))?.erro || 'Não foi possível enviar o arquivo.');
      } else {
        await api.post(`/api/central/candidatos/${candidatoId}/mensagens`, { texto: texto.trim() });
      }
      setTexto('');
      setArquivo(null);
      onEnviada();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : 'Não foi possível enviar.', 'erro');
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  };

  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  return (
    <div className="border-t border-borda bg-superficie px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {arquivo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-superficie-2 px-3 py-2 text-sm">
          <Paperclip className="size-4 text-suave" /> <span className="flex-1 truncate">{arquivo.name}</span>
          <button onClick={() => setArquivo(null)} className="grid size-8 place-items-center rounded-full hover:bg-superficie" aria-label="Tirar arquivo"><X className="size-4" /></button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-superficie-2" title="Anexar arquivo">
          <Paperclip className="size-5" /><span className="sr-only">Anexar arquivo</span>
          <input type="file" className="sr-only" accept=".pdf,.doc,.docx,image/jpeg,image/png" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </label>
        <textarea ref={campo} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={teclas} rows={1} maxLength={4000}
          placeholder={arquivo ? 'Legenda (opcional)' : 'Escreva uma mensagem'} aria-label="Mensagem"
          className="campo max-h-40 min-h-11 flex-1 resize-none !rounded-2xl !py-2.5" />
        <button onClick={() => void enviar()} disabled={enviando || (!texto.trim() && !arquivo)} aria-label="Enviar"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-destaque text-destaque-texto disabled:opacity-40">
          {enviando ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-suave">Enter envia · Shift+Enter quebra a linha · A mensagem aparece para o candidato no portal quando ele tiver acesso.</p>
    </div>
  );
}
