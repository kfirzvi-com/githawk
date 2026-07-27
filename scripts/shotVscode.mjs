/**
 * Screenshots the real extension inside a real VS Code.
 *
 * VS Code is Electron, so Playwright can drive its actual UI. That matters for
 * anything the browser harness cannot reach: QuickPick menus, the sidebar tree,
 * theme colours, and the native diff editor all live outside the webview.
 *
 *   npm run build
 *   node scripts/shotVscode.mjs [output-dir] [repo]
 *
 * Doubles as the way to produce documentation screenshots, so the README shows the
 * real thing rather than a mock.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const outDir = process.argv[2] ?? 'artifacts/vscode';
const repo = process.argv[3] ?? '/tmp/githawk-sample';
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

    // Selecting a commit fills the Changes tree and the details panel.
    await click(rows.nth(4));
    await page.waitForTimeout(3000);
    await capture('02-commit-selected');

    // The Changes tree lives in the primary sidebar, which the maximized panel
    // hides, so un-maximize to show both at once.
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

    console.log(JSON.stringify({ shots }, null, 2));
} catch (error) {
    console.error('capture failed:', error instanceof Error ? error.message : error);
    await capture('99-failure-state');
    process.exitCode = 1;
} finally {
    await app.close();
}
