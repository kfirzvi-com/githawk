/**
 * Screenshots the real extension inside a real VS Code.
 *
 * VS Code is Electron, so Playwright can drive its actual UI. That matters for
 * anything the browser harness cannot reach: QuickPick menus, the sidebar tree,
 * theme colours, and the native diff editor all live outside the webview.
 *
 *   npm run build
 *   node scripts/shotVscode.mjs [output-dir] [workspace] [scenes]
 *
 * `scenes` is `all` (the default, and specific to the sample repository's
 * branches) or `repositories`, which captures only what any workspace has.
 *
 * Doubles as the way to produce documentation screenshots, so the README shows the
 * real thing rather than a mock.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const outDir = process.argv[2] ?? 'artifacts/vscode';
const repo = process.argv[3] ?? '/tmp/githawk-sample';
const scenes = process.argv[4] ?? 'all';
const extensionPath = fileURLToPath(new URL('..', import.meta.url));
const executablePath = `${extensionPath}/.vscode-test/vscode-darwin-arm64-1.130.0/Visual Studio Code.app/Contents/MacOS/Electron`;

// A throwaway profile, so a previous run's layout or open editors cannot change
// what the screenshots show.
const userDataDir = '/tmp/githawk-shots-profile';
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const shots = [];
const app = await electron.launch({
    executablePath,
    args: [
        `--extensionDevelopmentPath=${extensionPath}`,
        `--user-data-dir=${userDataDir}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-release-notes',
        '--skip-welcome',
        '--disable-telemetry',
        repo,
    ],
});

const page = await app.firstWindow();
page.setDefaultTimeout(30_000);
await page.setViewportSize({ width: 1500, height: 950 });

const capture = async (name) => {
    const path = `${outDir}/${name}.png`;
    await page.screenshot({ path });
    shots.push(path);
};

const runCommand = async (command) => {
    // The palette is the only reliable way to invoke a command from the UI.
    await page.keyboard.press('Meta+Shift+P');
    await page.waitForSelector('.quick-input-widget:visible');
    await page.keyboard.type(command);
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(700);
};

/**
 * A screenshot of a default window is mostly chrome. Clearing the notification
 * about disabled extensions and the Chat sidebar leaves the extension itself,
 * and maximizing the panel gives the graph room to be legible.
 */
const composeWindow = async () => {
    await runCommand('Notifications: Clear All Notifications');
    await runCommand('View: Close Secondary Side Bar');
    await runCommand('View: Toggle Maximized Panel');
    await page.waitForTimeout(1500);
};

try {
    await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });
    // Let the extension host finish activating before asking it for anything.
    await page.waitForTimeout
        ? await page.waitForTimeout(4000)
        : null;

    await runCommand('GitHawk: Open Git Graph');
    await page.waitForTimeout(2500);
    await composeWindow();
    await capture('01-graph-panel');

    // The graph itself lives in a webview iframe, nested one level.
    const outer = page.frameLocator('iframe.webview');
    const inner = outer.frameLocator('iframe#active-frame');
    const rows = inner.getByTestId('git-graph').locator('button');
    await rows.first().waitFor();

    /*
     * `force: true` on every click inside the webview. Playwright's visibility
     * check is unreliable for a doubly-nested iframe inside Electron — it resolves
     * the right element and then reports it as not visible — and these elements are
     * demonstrably on screen in the captures.
     */
    const click = (locator, options = {}) =>
        locator.click({ force: true, ...options });

    /*
     * Matched on the leading marker glyph: ○ for a local branch, ◊ for a remote
     * one. Without it, /main/ also matches origin/main.
     */
    const localBranch = (name) =>
        inner
            .getByTestId('branch-list')
            .getByRole('button', { name: new RegExp(`○ ${name}`) });
    const remoteBranch = (name) =>
        inner
            .getByTestId('branch-list')
            .getByRole('button', { name: new RegExp(`◊ ${name}`) });

    /**
     * Clicks something in the webview and waits for the QuickPick it opens.
     *
     * Retried, because the first click after the panel is composed is sometimes
     * swallowed — VS Code is still settling focus, and the message never reaches
     * the host. A retry is far cheaper than a flaky capture.
     */
    const openQuickPick = async (locator, options = {}) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            await click(locator, options);
            try {
                await page.waitForSelector('.quick-input-widget:visible', {
                    timeout: 5000,
                });
                await page.waitForTimeout(1200);
                return;
            } catch {
                console.warn(`no quick pick after click ${attempt}, retrying`);
            }
        }
        throw new Error('the quick pick never opened');
    };

    /*
     * The repository selector, and the picker behind it. Present in any
     * workspace, so this runs before the sample-specific scenes.
     */
    const repositoryPicker = inner.getByTestId('repository-picker');
    await repositoryPicker.waitFor();
    await capture('09-repository-selector');
    await openQuickPick(repositoryPicker);
    await capture('10-repository-picker');

    /*
     * The gear that jumps to the depth setting. It sits in the title bar, where
     * it is always visible, and on the "Search again" row itself — VS Code only
     * paints a row's buttons while that row is hovered or active, so the hover
     * is what makes the second one appear.
     */
    await page
        .locator('.quick-input-list .monaco-list-row', {
            hasText: 'Search again',
        })
        .hover();
    await page.waitForTimeout(800);
    await capture('11-repository-picker-depth-setting');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);

    // Everything below depends on the sample repository's own branches.
    if (scenes === 'all') {
        // Selecting a commit fills the Changes tree and the details panel.
        await click(rows.nth(4));
        await page.waitForTimeout(3000);
        await capture('02-commit-selected');

        // The Changes tree lives in the primary sidebar, which the maximized
        // panel hides, so un-maximize to show both at once.
        await runCommand('View: Toggle Maximized Panel');
        await page.waitForTimeout(1500);
        await capture('03-changes-tree');
        await runCommand('View: Toggle Maximized Panel');
        await page.waitForTimeout(1200);

        // A branch that is purely behind: the Update entry leads.
        await click(localBranch('main'));
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(1500);
        await capture('04-branch-menu-behind');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // A diverged branch takes a different path through the same groups.
        await click(localBranch('feature/login'));
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(1500);
        await capture('05-branch-menu-diverged');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // A remote branch: check out, and delete on the remote.
        await click(remoteBranch('origin/feature/login'));
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(1500);
        await capture('06-branch-menu-remote');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // The grouped commit menu, via right-click on a row.
        await click(rows.nth(3), { button: 'right' });
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(1500);
        await capture('07-commit-menu-grouped');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // Several commits selected: the aggregate appears without a button press.
        await click(rows.nth(2));
        await page.waitForTimeout(700);
        await click(rows.nth(5), { modifiers: ['Meta'] });
        await click(rows.nth(8), { modifiers: ['Meta'] });
        await page.waitForTimeout(4000);
        await capture('08-multi-selection-aggregate');

        /*
         * Worktrees. The sample repository has two beyond its own — one live,
         * one whose directory was deleted — so the branch badge, the sidebar
         * section, and the "cannot be checked out here" menu are all reachable.
         */
        // Rows are labelled relative to the repository's own directory, so
        // githawk-sample-handbook reads as "handbook" here.
        await openQuickPick(
            inner
                .getByTestId('worktree-list')
                .getByRole('button', { name: /handbook/ })
        );
        await capture('12-worktree-actions');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        await openQuickPick(inner.getByTestId('manage-worktrees'));
        await capture('13-worktree-manager');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);

        // A branch checked out elsewhere: no checkout entry, a worktree instead.
        await openQuickPick(localBranch('docs/handbook'));
        await capture('14-branch-menu-in-worktree');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(600);
    }

    console.log(JSON.stringify({ shots }, null, 2));
} catch (error) {
    console.error('capture failed:', error instanceof Error ? error.message : error);
    await capture('99-failure-state');
    process.exitCode = 1;
} finally {
    await app.close();
}
