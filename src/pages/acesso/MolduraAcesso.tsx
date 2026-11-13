import type { ReactNode } from 'react';
import { LogoHummm, NomePlataforma } from '../../components/Marca';

/**
 * Moldura das telas de acesso: painel grafite com a logo oficial da Hummm! Pizzas
 * (no celular vira uma faixa no topo) e o formulário ao lado.
 */
export function MolduraAcesso({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(420px,5fr)_7fr]">
      <aside className="relative flex flex-col justify-between overflow-hidden bg-grafite px-6 pb-8 pt-[max(2rem,env(safe-area-inset-top))] text-creme lg:px-12 lg:py-12">
        <div className="flex flex-col items-center gap-5 lg:items-start">
          <LogoHummm fundo="escuro" className="h-12 lg:h-16" />
          <div className="flex items-center gap-3">
            <span className="h-px w-6 bg-amarelo/60" aria-hidden />
            <NomePlataforma escuro className="text-[28px] lg:text-[34px]" />
          </div>
        </div>
        <p className="mt-6 hidden max-w-sm text-[15px] leading-relaxed text-creme/70 lg:block">
          Recrutamento da Hummm! Pizzas: candidaturas, conversas e entrevistas em um só lugar.
        </p>
        <div className="faixa-marca absolute inset-x-0 bottom-0 h-1.5" aria-hidden />
      </aside>
      <main className="flex items-start justify-center px-5 py-10 sm:items-center lg:px-12">
        <div className="w-full max-w-[420px]">
          <h1 className="text-2xl font-bold tracking-tight">{titulo}</h1>
          {subtitulo && <p className="mt-1.5 text-[15px] text-suave">{subtitulo}</p>}
          <div className="mt-7">{children}</div>
          <p className="mt-10 text-center text-xs text-suave">Hummm! Pizzas · TI - Tecnologia da Informação</p>
        </div>
      </main>
    </div>
  );
}
