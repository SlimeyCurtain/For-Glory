import { defineConfig } from 'vite';

// Served from https://<user>.github.io/For-Glory/ (a GitHub Pages project
// site, not a domain root), so asset URLs need the repo name as a base path.
export default defineConfig({
  base: '/For-Glory/',
});
