import fs from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** Grava a versão do build no service worker: build novo = sw.js novo = a tela recarrega sozinha. */
function versaoNoServiceWorker(): Plugin {
  const versao = `${JSON.parse(fs.readFileSync('package.json', 'utf8')).version}-${Date.now().toString(36)}`;
  let saida = 'dist';
  return {
    name: 'aprovarh-sw-versao',
    apply: 'build',
    configResolved(c) {
      saida = c.build.outDir;
    },
    closeBundle() {
      const sw = path.resolve(saida, 'sw.js');
      if (fs.existsSync(sw)) fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__APROVARH_VERSAO__', versao));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versaoNoServiceWorker()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.PORT || 3000}`, changeOrigin: false } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
