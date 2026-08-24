import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Fully static output: the site ships as plain HTML + a little JS and talks to
// the separate API over fetch. Nothing here renders on a server, which is what
// keeps pages small enough to be worth loading on 3G.
export default defineConfig({
  output: 'static',
  server: { port: 4321 },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    inlineStylesheets: 'auto',
  },
});
