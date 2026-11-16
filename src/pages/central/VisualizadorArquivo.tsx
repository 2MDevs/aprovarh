import { Download, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Aviso } from '../../components/ui';

/**
 * Abre o arquivo (currículo, foto, anexo) por cima da tela, sem baixar.
 * PDF e imagem aparecem direto. Word (DOC/DOCX) o navegador não sabe mostrar: nesse caso fica só o botão de baixar.
 */
export function VisualizadorArquivo({ url, urlBaixar, nome, tipoMime, onFechar }: { url: string; urlBaixar: string; nome: string; tipoMime: string; onFechar: () => void }) {
  const [blob, setBlob] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const fechar = useRef(onFechar);
  fechar.current = onFechar;
  const pdf = tipoMime === 'application/pdf';
  const imagem = tipoMime.startsWith('image/');
  const mostra = pdf || imagem;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar.current();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    if (!mostra) return;
    let vivo = true;
    let criado: string | null = null;
    fetch(url, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.erro ?? 'Não foi possível abrir o arquivo.');
        return r.blob();
      })
      .then((b) => {
        if (!vivo) return;
        criado = URL.createObjectURL(new Blob([b], { type: tipoMime }));
        setBlob(criado);
      })
      .catch((e: Error) => vivo && setErro(e.message));
    return () => { vivo = false; if (criado) URL.revokeObjectURL(criado); };
  }, [url, tipoMime, mostra]);

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-grafite/80 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={`Arquivo: ${nome}`}>
      <div className="flex items-center gap-2 bg-grafite px-4 py-2.5 text-creme">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{nome}</p>
        <a href={urlBaixar} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-amarelo px-4 text-sm font-semibold text-grafite hover:opacity-90">
          <Download className="size-4" /> Baixar
        </a>
        <button onClick={onFechar} aria-label="Fechar" className="grid size-10 place-items-center rounded-full hover:bg-white/10"><X className="size-5" /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
        {!mostra ? (
          <div className="max-w-md rounded-2xl bg-superficie p-6 text-center">
            <p className="font-semibold">Este arquivo é do Word</p>
            <p className="mt-1 text-sm text-suave">O navegador só consegue mostrar PDF e imagem na tela. Use o botão Baixar para abrir este arquivo.</p>
          </div>
        ) : erro ? (
          <div className="max-w-md"><Aviso tipo="erro">{erro}</Aviso></div>
        ) : !blob ? (
          <p className="flex items-center gap-2 text-sm text-creme"><Loader2 className="size-5 animate-spin" aria-hidden /> Abrindo...</p>
        ) : pdf ? (
          <iframe src={blob} title={nome} className="h-full w-full max-w-5xl rounded-xl bg-white" />
        ) : (
          <img src={blob} alt={nome} className="max-h-full max-w-full rounded-xl bg-white object-contain" />
        )}
      </div>
    </div>
  );
}
