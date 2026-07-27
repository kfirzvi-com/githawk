/**
 * Screenshots the harness rendering a real repository dump, and reports what it
 * actually drew.
 *
 *   npx vite-node scripts/dumpGraph.ts -- <repo-path> [limit]
 *   npm run dev:webview          # in another terminal
 *   node scripts/shotReal.mjs artifacts/real.png [height]
 *
 * The counts matter as much as the picture: one dot and one row per commit is
 * the cheapest proof that nothing was silently dropped.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const output = process.argv[2] ?? 'artifacts/real.png';
const height = Number(process.argv[3] ?? 1100);
const url = process.env.HARNESS_URL ?? 'http://localhost:5173';

mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height } });

const problems = [];
page.on('console', (message) => {
    if (message.type() === 'error') {
        problems.push(message.text());
    }
});
page.on('pageerror', (error) => problems.push(error.message));

await page.goto(`${url}/?topology=real`, { waitUntil: 'networkidle' });

const graph = page.locator('[data-testid="git-graph"]');
await graph.waitFor({ timeout: 15_000 });

const [dots, rows, segments] = await Promise.all([
    graph.locator('circle').count(),
    graph.locator('button').count(),
    graph.locator('path').count(),
]);

await page.screenshot({ path: output });
await browser.close();

console.log(
    JSON.stringify({ output, dots, rows, edgeSegments: segments, problems }, null, 2)
);

if (problems.length > 0) {
    process.exitCode = 1;
}
