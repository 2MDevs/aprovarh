/**
 * Marca: logo oficial da Hummm! Pizzas (arquivos em /public/brand) + o nome da plataforma, aprovaRH.
 * hummm-logo-escuro.svg = letras claras, para fundo grafite; hummm-logo-claro.svg = letras grafite, para fundo claro.
 */
export function LogoHummm({ fundo, className = 'h-12' }: { fundo: 'escuro' | 'claro'; className?: string }) {
  return (
    <img
      src={fundo === 'escuro' ? '/brand/hummm-logo-escuro.svg' : '/brand/hummm-logo-claro.svg'}
      alt="Hummm! Pizzas"
      className={`w-auto select-none ${className}`}
      draggable={false}
    />
  );
}

export function NomePlataforma({ className = 'text-2xl', escuro = false }: { className?: string; escuro?: boolean }) {
  return (
    <span className={`font-bold tracking-tight ${className} ${escuro ? 'text-creme' : 'text-texto'}`}>
      aprova<span className="rounded-md bg-amarelo px-1.5 text-grafite">RH</span>
    </span>
  );
}
