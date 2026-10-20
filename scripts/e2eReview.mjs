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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// 1b. Escape: a new box goes without a trace; a saved thread folds away.
await page.keyboard.press('Meta+K'); await page.keyboard.press(']'); await page.waitForTimeout(1500);
await page.keyboard.press('Meta+K'); await page.keyboard.press('Shift+C'); await page.waitForTimeout(1500);
await shot('1b-new-box');
await page.keyboard.type('never mind'); await page.waitForTimeout(400);
results.typedIntoNewBox = await page.locator('.review-widget .review-comment .monaco-editor', { hasText: 'never mind' }).count();
await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
results.escClosesNewBox = (await page.locator('.review-widget:visible', { hasText: 'New review comment' }).count()) === 0 && (await comments('never mind')) === 0;
// Back to the first change, from its row, to put the keyboard in its thread.
await page.locator('.monaco-list-row', { hasText: /Lines 14/ }).first().click(); await page.waitForTimeout(1500);
await page.locator('.review-widget .review-comment', { hasText: 'Rename paymentTermsDays' }).first().click({ force: true }); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
results.escFoldsThread = (await comments('Rename paymentTermsDays')) === 0;
// Comment again on the same change: the folded thread opens, beside a new box.
await page.locator('.editor.modified .codelens-decoration a', { hasText: 'Comment' }).first().click({ force: true }); await page.waitForTimeout(1500);
results.earlierCommentShownAgain = await comments('Rename paymentTermsDays');
await page.keyboard.press('Escape'); await page.waitForTimeout(1000);

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

// 3b. From comment to comment by keyboard.
await page.keyboard.press('Meta+K'); await page.keyboard.press('Shift+]'); await page.waitForTimeout(1500);
results.nextComment = await page.locator('.statusbar', { hasText: /comment 1 of 1/ }).count();

// 4. The tree by keyboard: click a row, the keyboard stays; Space ticks it, Down and Space the next.
await page.locator('.monaco-list-row', { hasText: /Lines 19/ }).first().click(); await page.waitForTimeout(2000);
results.focusStayedInTree = await page.evaluate(() => Boolean(document.activeElement?.closest('#workbench\\.view\\.extension\\.gitHawkSidebar')));
await page.keyboard.press('Space'); await page.waitForTimeout(1500);
results.afterFirstSpace = (await page.locator('.pane-header', { hasText: 'Review' }).first().innerText()).split('\n')[1];
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.waitForTimeout(1500);
await shot('4-space');
results.spaceTicked = await page.locator('.pane-header', { hasText: 'Review' }).first().innerText();
results.fileUntouched = !(await page.locator('.tab.dirty').count());
// (Checked again at the end: nothing in the flow may type into the code.)
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

// 5b. The agent writes back; the reader sees it, answers, and resolves.
const document = readFileSync('/tmp/githawk-e2e-sample/.git/githawk/review.md', 'utf8');
const commentId = /id: `([^`]+)`/.exec(document)?.[1];
const repliesPath = /`([^`]*replies\.jsonl)`/.exec(document)?.[1];
results.documentSaysHowToReply = Boolean(commentId && repliesPath);
if (commentId && repliesPath) {
    writeFileSync(repliesPath, JSON.stringify({ comment: commentId, status: 'question', reply: 'Should it be termsDays everywhere, including the API field?' }) + '\n');
    const notice = page.locator('.notification-toast', { hasText: 'replied' });
    await notice.waitFor({ timeout: 10_000 }).catch(() => {});
    results.noticeShown = await notice.count();
    await shot('5b-notice');
    await notice.locator('.monaco-button', { hasText: 'Show' }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
    results.agentReplyShown = await comments('including the API field');
    await shot('5c-agent-reply');
    // Answer in the thread's reply box, by keyboard.
    results.replyBoxes = await page.locator('.review-widget .comment-form').evaluateAll((forms) => forms.filter((form) => form.getBoundingClientRect().height > 0).length);
    const replyEditor = page.locator('.review-widget .comment-form .monaco-editor').last();
    await replyEditor.scrollIntoViewIfNeeded(); await replyEditor.click({ force: true }); await page.waitForTimeout(600);
    await page.keyboard.type('Keep the API field as it is; internal only.');
    await page.keyboard.press('Meta+Enter'); await page.waitForTimeout(2000);
    results.answerShown = await comments('internal only');
    await shot('5d-answered');
    // Resolve it from the thread's title.
    await page.locator('.review-widget .codicon-check').first().click({ force: true }); await page.waitForTimeout(1500);
    results.resolvedFolded = (await comments('internal only')) === 0;
    await shot('5e-resolved');
}

// 6. Reload the window: the review, its marks and comments come back.
await run('Developer: Reload Window');
await page.waitForTimeout(8000);
await run('GitHawk: Show Uncommitted Changes');
await page.waitForTimeout(3000);
await page.locator('.monaco-list-row', { hasText: /Lines 14/ }).first().click(); await page.waitForTimeout(2500);
await shot('6-after-reload');
// Resolved, so folded in the editor: the Comments panel is where it still shows.
await run('View: Focus on Comments View'); await page.waitForTimeout(1500);
results.afterReload = {
    commentShown: await page.locator('.comments-panel .monaco-list-row', { hasText: 'everywhere' }).count(),
    reviewTitle: await page.locator('.pane-header', { hasText: 'Review' }).count(),
};
console.log(JSON.stringify(results, null, 1));
await app.close();
const failed = [
    results.added !== 1 && 'comment from the button',
    results.typedIntoNewBox !== 1 && 'a new comment box takes the keyboard',
    !results.escClosesNewBox && 'Escape closes a new comment box',
    !results.escFoldsThread && 'Escape folds a saved thread',
    results.earlierCommentShownAgain !== 1 && 'commenting again shows the earlier comment',
    results.edited !== 1 && 'edit a comment',
    results.secondAdded !== 1 && 'comment by keyboard',
    !results.deleted && 'delete a comment',
    !results.focusStayedInTree && 'keyboard stays in the tree',
    results.nextComment !== 1 && 'next comment by keyboard',
    !/1\/\d+ changes/.test(results.afterFirstSpace ?? '') && 'Space ticks a change',
    !/2\/\d+ changes/.test(results.spaceTicked ?? '') && 'Space ticks the next change',
    !results.fileUntouched && 'Space leaves the file alone',
    !String(results.sentToRunning).startsWith('Please address') && 'send to a running session',
    !results.documentSaysHowToReply && 'the handoff says how to reply',
    !results.noticeShown && 'the agent replying is announced',
    results.agentReplyShown !== 1 && "the agent's reply shows under the comment",
    results.replyBoxes !== 1 && 'one reply box under the conversation',
    results.answerShown !== 1 && 'answering the agent in the thread',
    !results.resolvedFolded && 'resolving folds the thread',
    results.afterReload?.commentShown !== 1 && 'comments survive a reload',
].filter(Boolean);
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'every step passed');
process.exitCode = failed.length ? 1 : 0;
