/* aprovaRH · service worker
 * - Páginas: sempre busca na rede (versão nova entra na hora); sem rede, usa a última cópia.
 * - Arquivos do build (/assets/*, com hash no nome): guardados em cache.
 * - API (/api/*): nunca passa pelo cache.
 * Quando um build novo é publicado, este arquivo muda (VERSAO) e a tela recarrega sozinha.
 */
const VERSAO = '__APROVARH_VERSAO__';
const CACHE = `aprovarh-${VERSAO}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('aprovarh-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put('/', copia));
          return r;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/brand/') || /\.(png|svg|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return r;
      })),
    );
  }
});
