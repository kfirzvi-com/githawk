import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
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