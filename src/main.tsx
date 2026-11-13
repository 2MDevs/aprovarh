import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: registra o service worker e recarrega sozinho quando uma versão nova assume.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let recarregando = false;
  const jaControlado = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaControlado || recarregando) return;
    recarregando = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Confere se há versão nova a cada 10 minutos e quando a pessoa volta para a aba.
      setInterval(() => void reg.update(), 10 * 60_000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void reg.update());
    }).catch(() => {});
  });
}
