import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Fully static output: the site ships as plain HTML + a little JS and talks to
// the separate API over fetch. Nothing here renders on a server, which is what
// keeps pages small enough to be worth loading on 3G.
// BASE_PATH is set by the GitHub Pages workflow (e.g. "/UTG-Connect") since a
// project Pages site is served from a subpath, not the domain root. Local dev
// and any host that owns its own domain leave it unset and get "/".
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  output: 'static',
  base,
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
