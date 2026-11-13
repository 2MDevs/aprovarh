import { UserRound } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { urlArquivo } from './tipos';

/** Foto 3x4 em miniatura (a rota confere a permissão; sem foto, mostra as iniciais). */
export function Foto({ candidatoId, fotoId, nome, tamanho = 48 }: { candidatoId: string; fotoId: string | null; nome: string; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  const iniciais = nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const estilo = { width: tamanho, height: tamanho };
  if (!fotoId || falhou) {
    return (
      <span className="grid shrink-0 place-items-center rounded-full bg-creme font-semibold text-grafite dark:bg-amarelo/20 dark:text-amarelo" style={{ ...estilo, fontSize: tamanho / 2.8 }} aria-hidden>
        {iniciais || <UserRound className="size-5" />}
      </span>
    );
  }
  return <img src={urlArquivo(candidatoId, fotoId, 'miniatura')} alt="" loading="lazy" onError={() => setFalhou(true)} className="shrink-0 rounded-full object-cover" style={estilo} />;
}

/** Pílula colorida de tag ou status (o texto sempre aparece; a cor é só apoio). */
export function Pilula({ cor, children, pequena }: { cor: string; children: ReactNode; pequena?: boolean }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-borda bg-superficie font-semibold ${pequena ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'}`}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: cor }} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Hora para a lista: hoje → "14:05"; ontem → "Ontem"; antes → "12/11". */
export function horaCurta(v: string): string {
  const d = new Date(v);
  const fuso = { timeZone: 'America/Sao_Paulo' } as const;
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', fuso);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (dia(d) === dia(hoje)) return d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' });
  if (dia(d) === dia(ontem)) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' });
}
