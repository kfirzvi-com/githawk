import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: '../../../dist/webview-ui',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    host: 'localhost',
    cors: true
  },
  css: {
    postcss: './postcss.config.js'
  }
});