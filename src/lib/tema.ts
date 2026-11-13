export type Tema = 'claro' | 'escuro' | 'sistema';

const CHAVE = 'arh.tema';

export function temaSalvo(): Tema {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === 'claro' || v === 'escuro' ? v : 'sistema';
  } catch {
    return 'sistema';
  }
}

export function aplicarTema(t: Tema) {
  try {
    if (t === 'sistema') localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, t);
  } catch {
    /* navegador sem armazenamento: vale só nesta aba */
  }
  const escuro = t === 'escuro' || (t === 'sistema' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', escuro);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#141413' : '#F6F4EE');
}
