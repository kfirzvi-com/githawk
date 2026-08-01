import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
// vitest/config re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from 'vitest/config';
import { devServerPort } from './scripts/harness';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
    // The webview is a self-contained app inside the presentation tier.
    root: here('src/presentation/webview'),
    // `root` is the webview dir, so the Svelte config must be located explicitly.
    plugins: [svelte({ configFile: here('svelte.config.js') }), tailwindcss()],
    build: {
        // Absolute, so it cannot silently resolve outside the repository.
        outDir: here('dist/webview'),
        emptyOutDir: true,
        // False, not excluded-after-the-fact: the map was already dropped by
        // .vscodeignore, so emitting it only left a sourceMappingURL comment
        // in the shipped bundle pointing at a file that is not there.
        sourcemap: false,
        rollupOptions: {
            // main.ts rather than index.html: the extension host builds its own
            // HTML (it needs a CSP nonce), so predictable asset names matter
            // more than a generated document.
            input: here('src/presentation/webview/main.ts'),
            output: {
                entryFileNames: 'assets/main.js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]',
            },
        },
    },
    server: {
        port: devServerPort(),
        host: 'localhost',
        // Fail rather than fall forward to the next free port. Vite's default
        // is to shrug and take 5174, which leaves Playwright pointed at
        // whatever is on 5173 — quite possibly another checkout's dev server,
        // serving another branch's code to this branch's baselines.
        strictPort: true,
    },
    test: {
        // Tests live across all four tiers, so they resolve from the repository
        // root rather than from the webview `root` above.
        root: here('.'),
        include: ['src/**/*.test.ts'],
        environment: 'node',
    },
});
