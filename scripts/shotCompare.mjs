/**
 * Drives the comparison UI in the harness and screenshots it.
 *
 *   npm run dev:webview
 *   node scripts/shotCompare.mjs artifacts/compare.png
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from '@playwright/test';

const output = process.argv[2] ?? 'artifacts/compare.png';
const url = process.env.HARNESS_URL ?? 'http://localhost:5173';

mkdirSync(dirname(output), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 820 } });

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(e.message));

await page.goto(`${url}/?topology=nested-branches`, { waitUntil: 'networkidle' });
const rows = page.getByTestId('git-graph').locator('button');
await rows.first().waitFor();

// Multi-select three non-adjacent commits the way a person would.
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
await rows.nth(1).click();
await rows.nth(4).click({ modifiers: [modifier] });
await rows.nth(7).click({ modifiers: [modifier] });

const selectionBar = page.getByText('3 commits selected');
await selectionBar.waitFor();
const notContiguous = await page.getByText(/not contiguous/).isVisible();

await page.getByRole('button', { name: 'Review together' }).click();
await page.getByText(/selected commits/).first().waitFor();
await page.getByText(/left out/).waitFor();

await page.screenshot({ path: output });
await browser.close();

console.log(
    JSON.stringify({ output, notContiguous, problems }, null, 2)
);
if (problems.length > 0) {
    process.exitCode = 1;
}
