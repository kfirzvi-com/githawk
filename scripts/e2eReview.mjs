/**
 * Review mode end to end, in a real VS Code, the way a person uses it: start
 * a review of uncommitted work, comment from the button on a change, edit and
 * delete a comment, tick changes from the tree with the keyboard, hand the
 * comments to a session already running in a terminal, and reload the window
 * to find all of it still there.
 *
 *   npm run build && node scripts/e2eReview.mjs [screenshot-dir]
 *
 * Prints what each step found and exits non-zero if any step failed. Every
 * bug this has caught passed the unit and integration tiers: they cannot see
 * where the keyboard is, what VS Code's comment widget does, or what a click
 * opens.
 */
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2] ?? 'artifacts/e2e-review';
mkdirSync(out, { recursive: true });
execFileSync('./scripts/makeReviewSample.sh', ['/tmp/githawk-e2e-sample']);
const cache = join(process.cwd(), '.vscode-test');
const install = readdirSync(cache).filter((name) => name.startsWith('vscode-')).sort().reverse()[0];
const executablePath = join(cache, install, 'Visual Studio Code.app/Contents/MacOS/Code');
const profile = '/tmp/githawk-e2e-profile';
rmSync(profile, { recursive: true, force: true });
rmSync('/tmp/githawk-e2e-received.txt', { force: true });
const results = {};
const launch = async () => {
  const app = await electron.launch({ executablePath,
    args: [`--extensionDevelopmentPath=${process.cwd()}`, `--user-data-dir=${profile}`, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '/tmp/githawk-e2e-sample'] });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
  await page.waitForTimeout(5000);
  return { app, page };
};
let { app, page } = await launch();
const run = async (c) => { await page.keyboard.press('Meta+Shift+P'); await page.waitForSelector('.quick-input-widget:visible'); await page.keyboard.type(c); await page.waitForTimeout(800); await page.keyboard.press('Enter'); await page.waitForTimeout(2000); };
const chord = async (k) => { await page.keyboard.press('Meta+K'); await page.keyboard.press(k); await page.waitForTimeout(2000); };
const shot = (n) => page.screenshot({ path: `${out}/e2e-${n}.png` });
const comments = (t) => page.locator('.review-widget .review-comment', { hasText: t }).count();

// 1. Start reviewing uncommitted work, comment on the first change.
await run('GitHawk: Show Uncommitted Changes');
await chord('Shift+R');
await run('View: Close Panel');
await page.locator('.editor.modified .codelens-decoration a', { hasText: 'Comment' }).first().click(); await page.waitForTimeout(2000);
await page.keyboard.type('Rename paymentTermsDays to termsDays.'); await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(2000);
results.added = await comments('Rename paymentTermsDays');

// 2. Edit it, through the comment's own menu.
const comment = page.locator('.review-widget .review-comment', { hasText: 'Rename paymentTermsDays' }).first();
await comment.hover(); await page.waitForTimeout(500);
await shot('2-comment-actions');
await comment.locator('.codicon-edit').first().click({ force: true }); await page.waitForTimeout(800);
await page.keyboard.press('Meta+A'); await page.keyboard.type('Rename paymentTermsDays to termsDays, everywhere.');
await page.locator('.review-widget a, .review-widget button', { hasText: /^Save$/ }).first().click(); await page.waitForTimeout(1500);
results.edited = await comments('everywhere');
await shot('2-edited');

// 3. A second comment on the next change, then delete it.
await chord(']');
await chord('Shift+C');
await page.keyboard.type('Temporary note.'); await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(2000);
results.secondAdded = await comments('Temporary note');
const temp = page.locator('.review-widget .review-comment', { hasText: 'Temporary note' }).first();
await temp.hover(); await page.waitForTimeout(500);
await temp.locator('.codicon-trash').first().click({ force: true }); await page.waitForTimeout(1500);
results.deleted = (await comments('Temporary note')) === 0;

// 4. The tree by keyboard: click a row, the keyboard stays; Space ticks it, Down and Space the next.
await page.locator('.monaco-list-row', { hasText: /Lines 19/ }).first().click(); await page.waitForTimeout(2000);
results.focusStayedInTree = await page.evaluate(() => Boolean(document.activeElement?.closest('#workbench\\.view\\.extension\\.gitHawkSidebar')));
await page.keyboard.press('Space'); await page.waitForTimeout(1500);
results.afterFirstSpace = (await page.locator('.pane-header', { hasText: 'Review' }).first().innerText()).split('\n')[1];
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.waitForTimeout(1500);
await shot('4-space');
results.spaceTicked = await page.locator('.pane-header', { hasText: 'Review' }).first().innerText();
results.fileUntouched = !(await page.locator('.tab.dirty').count());
// 5. Send to a session already running in a terminal.
await run('Terminal: Create New Terminal');
await page.waitForTimeout(2500);
await page.keyboard.type('head -n1 > /tmp/githawk-e2e-received.txt'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
await page.locator('.editor.modified').first().click(); await page.waitForTimeout(500);
await chord('Shift+S');
await page.waitForSelector('.quick-input-widget:visible'); await page.waitForTimeout(800);
await shot('5-send-picker');
await page.keyboard.press('Enter'); await page.waitForTimeout(3000);
results.sentToRunning = existsSync('/tmp/githawk-e2e-received.txt') ? readFileSync('/tmp/githawk-e2e-received.txt', 'utf8').slice(0, 90) : 'nothing received';

// 6. Reload the window: the review, its marks and comments come back.
await run('Developer: Reload Window');
await page.waitForTimeout(8000);
await run('GitHawk: Show Uncommitted Changes');
await page.waitForTimeout(3000);
await page.locator('.monaco-list-row', { hasText: /Lines 14/ }).first().click(); await page.waitForTimeout(2500);
await shot('6-after-reload');
results.afterReload = { commentShown: await comments('everywhere'), reviewTitle: await page.locator('.pane-header', { hasText: 'Review' }).count() };
console.log(JSON.stringify(results, null, 1));
await app.close();
const failed = [
    results.added !== 1 && 'comment from the button',
    results.edited !== 1 && 'edit a comment',
    results.secondAdded !== 1 && 'comment by keyboard',
    !results.deleted && 'delete a comment',
    !results.focusStayedInTree && 'keyboard stays in the tree',
    !/1\/\d+ changes/.test(results.afterFirstSpace ?? '') && 'Space ticks a change',
    !/2\/\d+ changes/.test(results.spaceTicked ?? '') && 'Space ticks the next change',
    !results.fileUntouched && 'Space leaves the file alone',
    !String(results.sentToRunning).startsWith('Please address') && 'send to a running session',
    results.afterReload?.commentShown !== 1 && 'comments survive a reload',
].filter(Boolean);
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'every step passed');
process.exitCode = failed.length ? 1 : 0;
