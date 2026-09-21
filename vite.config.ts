import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Served from https://<user>.github.io/For-Glory/ (a GitHub Pages project
// site, not a domain root), so asset URLs need the repo name as a base path.
export default defineConfig({
  base: '/For-Glory/',
  build: {
    // Two standalone pages: the RTS at the root and the duel game at
    // /duel.html. Without listing both here, Vite's default build only
    // picks up index.html and duel.html would 404 once deployed.
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        duel: resolve(import.meta.dirname, 'duel.html'),
      },
    },
  },
});
