import { AlertTriangle, Check, Eye, EyeOff, Info, Loader2, X } from 'lucide-react';
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
} from 'react';

// ── Botão ──────────────────────────────────────────────────────────────────
type Variante = 'principal' | 'secundario' | 'perigo' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  principal: 'bg-destaque text-destaque-texto hover:opacity-90',
  secundario: 'bg-superficie text-texto border border-borda hover:bg-superficie-2',
  perigo: 'bg-vermelho text-white hover:opacity-90',
  fantasma: 'text-texto hover:bg-superficie-2',
};

export function Botao({
  variante = 'principal', carregando, icone, children, className = '', ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean; icone?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={props.disabled || carregando}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition
        disabled:cursor-not-allowed disabled:opacity-55 ${VARIANTES[variante]} ${className}`}
    >
      {carregando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icone}
      {children}
    </button>
  );
}

// ── Campos ─────────────────────────────────────────────────────────────────
export function Campo({
  rotulo, ajuda, erro, className = '', ...props
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; ajuda?: ReactNode; erro?: string }) {
  const id = useId();
  const [ver, setVer] = useState(false);
  const senha = props.type === 'password';
  return (
    <div className={className}>
      <label htmlFor={id} className="rotulo">{rotulo}</label>
      <div className="relative">
        <input
          id={id}
          {...props}
          type={senha && ver ? 'text' : props.type}
          aria-invalid={Boolean(erro)}
          aria-describedby={ajuda || erro ? `${id}-ajuda` : undefined}
          className={`campo ${senha ? 'pr-12' : ''} ${erro ? 'border-vermelho' : ''}`}
        />
        {senha && (
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-suave hover:text-texto"
            aria-label={ver ? 'Esconder' : 'Mostrar'}
          >
            {ver ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        )}
      </div>
      {(erro || ajuda) && (
        <p id={`${id}-ajuda`} className={`mt-1.5 text-[13px] ${erro ? 'text-vermelho' : 'text-suave'}`}>{erro || ajuda}</p>
      )}
    </div>
  );
}

export function Selecao({ rotulo, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="rotulo">{rotulo}</label>
      <select id={id} {...props} className="campo">{children}</select>
    </div>
  );
}

export function Interruptor({ ligado, onChange, rotulo, descricao }: { ligado: boolean; onChange: (v: boolean) => void; rotulo: string; descricao?: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block text-sm font-semibold">{rotulo}</span>
        {descricao && <span className="block text-[13px] text-suave">{descricao}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={ligado} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-borda transition peer-checked:bg-verde peer-focus-visible:ring-4 peer-focus-visible:ring-amarelo/40
        after:absolute after:left-1 after:top-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" aria-hidden />
    </label>
  );
}

// ── Selo de situação (sempre com texto, nunca só cor) ──────────────────────
type Tom = 'verde' | 'cinza' | 'vermelho' | 'amarelo';
const TONS: Record<Tom, string> = {
  verde: 'bg-verde/12 text-verde dark:text-emerald-300',
  cinza: 'bg-superficie-2 text-suave border border-borda',
  vermelho: 'bg-vermelho/12 text-vermelho dark:text-red-300',
  amarelo: 'bg-amarelo/30 text-grafite dark:text-amarelo',
};
export function Selo({ tom = 'cinza', children }: { tom?: Tom; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${TONS[tom]}`}>{children}</span>;
}

// ── Avisos dentro da tela ──────────────────────────────────────────────────
export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'atencao' | 'erro'; children: ReactNode }) {
  const estilo = {
    info: 'bg-creme border-amarelo/60 text-grafite dark:bg-amarelo/10 dark:text-creme',
    atencao: 'bg-amarelo/25 border-amarelo text-grafite dark:text-creme',
    erro: 'bg-vermelho/10 border-vermelho/40 text-vermelho dark:text-red-300',
  }[tipo];
  const Icone = tipo === 'info' ? Info : AlertTriangle;
  return (
    <div role={tipo === 'erro' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border px-4 py-3 text-sm ${estilo}`}>
      <Icone className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Carregando({ texto = 'Carregando...' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-suave" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {texto}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-borda px-6 py-12 text-center">
      <p className="font-semibold">{titulo}</p>
      {children && <div className="mt-1 text-sm text-suave">{children}</div>}
    </div>
  );
}

// ── Cabeçalho de página ────────────────────────────────────────────────────
export function Cabecalho({ titulo, descricao, acoes }: { titulo: string; descricao?: string; acoes?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{titulo}</h1>
        {descricao && <p className="mt-1 max-w-2xl text-[15px] text-suave">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

// ── Abas em pílula ─────────────────────────────────────────────────────────
export function Abas<T extends string>({ abas, ativa, onChange }: { abas: { id: T; rotulo: string; icone?: ReactNode }[]; ativa: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-6 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-borda bg-superficie p-1">
      {abas.map((a) => (
        <button
          key={a.id}
          role="tab"
          aria-selected={a.id === ativa}
          onClick={() => onChange(a.id)}
          className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-semibold transition
            ${a.id === ativa ? 'bg-grafite text-white dark:bg-amarelo dark:text-grafite' : 'text-suave hover:text-texto'}`}
        >
          {a.icone}
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}

// ── Modal (no celular sobe de baixo, como folha) ───────────────────────────
export function Modal({
  aberto, onFechar, titulo, descricao, selo, children, rodape, largura = 'max-w-xl',
}: {
  aberto: boolean; onFechar: () => void; titulo: string; descricao?: string; selo?: ReactNode;
  children: ReactNode; rodape?: ReactNode; largura?: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    setTimeout(() => caixa.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-fechar])')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
      anterior?.focus?.();
    };
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-grafite/50 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div ref={caixa} role="dialog" aria-modal="true" aria-label={titulo}
        className={`flex max-h-[92dvh] w-full ${largura} flex-col rounded-t-3xl bg-superficie shadow-2xl sm:rounded-3xl`}>
        <div className="flex items-start gap-4 border-b border-borda px-6 pb-4 pt-6">
          {selo}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold sm:text-2xl">{titulo}</h2>
            {descricao && <p className="mt-1 text-sm text-suave">{descricao}</p>}
          </div>
          <button data-fechar onClick={onFechar} className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-superficie-2" aria-label="Fechar">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 border-t border-borda px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{rodape}</div>}
      </div>
    </div>
  );
}

// ── Selo quadrado com sigla (cards de integração) ──────────────────────────
export function SeloSigla({ sigla, cor, tamanho = 56 }: { sigla: string; cor: string; tamanho?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-2xl font-bold text-white" style={{ background: cor, width: tamanho, height: tamanho, fontSize: sigla.length > 2 ? 14 : 17 }} aria-hidden>
      {sigla}
    </span>
  );
}

// ── Avisos rápidos (toast) ─────────────────────────────────────────────────
type Toast = { id: number; texto: string; tipo: 'ok' | 'erro' };
const ToastCtx = createContext<(texto: string, tipo?: Toast['tipo']) => void>(() => {});
export const useAviso = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const avisar = useCallback((texto: string, tipo: Toast['tipo'] = 'ok') => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={avisar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {lista.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium shadow-lg
            ${t.tipo === 'ok' ? 'bg-grafite text-white' : 'bg-vermelho text-white'}`}>
            {t.tipo === 'ok' ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
            {t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Confirmação em modal (nunca alert/confirm do navegador). */
export function Confirmar({ aberto, titulo, texto, rotulo = 'Confirmar', perigo, carregando, onConfirmar, onCancelar }: {
  aberto: boolean; titulo: string; texto: ReactNode; rotulo?: string; perigo?: boolean; carregando?: boolean;
  onConfirmar: () => void; onCancelar: () => void;
}) {
  return (
    <Modal aberto={aberto} onFechar={onCancelar} titulo={titulo} largura="max-w-md"
      rodape={<>
        <Botao variante="secundario" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante={perigo ? 'perigo' : 'principal'} carregando={carregando} onClick={onConfirmar}>{rotulo}</Botao>
      </>}>
      <div className="text-[15px] text-suave">{texto}</div>
    </Modal>
  );
}

/** Mostrado quando a pessoa abre o endereço de uma tela que não pode usar (o servidor também recusa). */
export function SemPermissao() {
  return <Vazio titulo="Você não tem acesso a esta tela.">Se precisar, peça ao administrador.</Vazio>;
}

/** Mensagem de erro de carregamento com botão de tentar de novo. */
export function ErroCarregar({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div className="space-y-3">
      <Aviso tipo="erro">{mensagem}</Aviso>
      <Botao variante="secundario" onClick={onTentar}>Tentar de novo</Botao>
    </div>
  );
}
