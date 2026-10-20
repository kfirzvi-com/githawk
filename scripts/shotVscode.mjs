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
 * branches), `repositories`, which captures only what any workspace has,
 * `files`, which browses the whole project at an older commit in the Files
 * view, `blame`, which wants a workspace with real history rather than the
 * sample — the annotate column has nothing to say about a file with two commits —
 * or `review`, which walks review mode end to end on the workspace
 * `scripts/makeReviewSample.sh` builds.
 *
 * Doubles as the way to produce documentation screenshots, so the README shows the
 * real thing rather than a mock.
 */
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const outDir = process.argv[2] ?? 'artifacts/vscode';
const repo = process.argv[3] ?? '/tmp/githawk-sample';
const scenes = process.argv[4] ?? 'all';
const extensionPath = fileURLToPath(new URL('..', import.meta.url));
const executablePath = findVsCode();

/**
 * Whatever `@vscode/test-electron` last downloaded, wherever it put it.
 *
 * Both halves of this were hardcoded and both went stale: the version, which
 * moves every month, and the executable name — the app bundle contains `Code`,
 * not `Electron`, so the script had been failing to launch at all.
 */
function findVsCode() {
    const caches = [
        process.env.GITHAWK_VSCODE_CACHE,
        join(extensionPath, '.vscode-test'),
        join(homedir(), '.cache', 'githawk', 'vscode-test'),
    ].filter((path) => path !== undefined && existsSync(path));

    for (const cache of caches) {
        const installs = readdirSync(cache)
            .filter((name) => name.startsWith('vscode-'))
            .sort()
            .reverse();

        for (const install of installs) {
            const binary = join(
                cache,
                install,
                'Visual Studio Code.app/Contents/MacOS/Code'
            );
            if (existsSync(binary)) {
                return binary;
            }
        }
    }

    throw new Error(
        'No downloaded VS Code found. Run `npm run test:integration` once, or set GITHAWK_VSCODE_CACHE.'
    );
}

// A throwaway profile, so a previous run's layout or open editors cannot change
// what the screenshots show.
const userDataDir = '/tmp/githawk-shots-profile';
rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/*
 * The blame scene needs a setting on before the window opens, so it is seeded
 * into the throwaway profile rather than toggled afterwards — a decoration
 * drawn during the screenshot is a decoration that might not be there yet.
 */
/*
 * The review scene hands its comments to an AI CLI, so it seeds one that only
 * prints what it was given: the screenshot shows the handoff, and nothing
 * acts on the sample repository behind the script's back.
 */
if (scenes.startsWith('review')) {
    const agent = fileURLToPath(new URL('./fixtures/demoAgent.mjs', import.meta.url));
    mkdirSync(join(userDataDir, 'User'), { recursive: true });
    writeFileSync(
        join(userDataDir, 'User', 'settings.json'),
        JSON.stringify(
            {
                'editor.minimap.enabled': false,
                'workbench.startupEditor': 'none',
                'terminal.integrated.fontSize': 14,
                'gitHawk.aiTools': [
                    { name: 'Claude Code', command: 'claude', promptCommand: 'claude {prompt}' },
                    {
                        name: 'demo-agent',
                        command: `node ${agent}`,
                        promptCommand: `node ${agent} {prompt}`,
                    },
                ],
            },
            null,
            2
        )
    );
}

if (scenes === 'blame') {
    mkdirSync(join(userDataDir, 'User'), { recursive: true });
    writeFileSync(
        join(userDataDir, 'User', 'settings.json'),
        JSON.stringify(
            { 'gitHawk.blame.style': 'column', 'editor.minimap.enabled': false },
            null,
            2
        )
    );
}

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
    if (scenes !== 'blame' && !scenes.startsWith('review')) {
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
    }

    if (scenes === 'blame') {
        /*
         * The annotate column, switched on in the profile before launch. Wants
         * a workspace with real history: the sample repository's files have two
         * commits each and the column has nothing to say about them.
         */
        await page.keyboard.press('Meta+P');
        await page.waitForSelector('.quick-input-widget:visible');
        await page.keyboard.type('src/extension.ts');
        await page.waitForTimeout(1200);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        await capture('blame');
    }

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

    if (scenes === 'files') {
        /*
         * The Files view: the whole project at one commit, in the sidebar.
         * Driven from the palette rather than the commit's right-click menu:
         * a QuickPick opened from inside the webview loses focus to it under
         * Playwright and closes before it can be typed into. A commit is
         * selected first so the Changes tree is in shot above it.
         */
        await click(rows.nth(6));
        await page.waitForTimeout(2500);
        await runCommand('GitHawk: Browse Files At A Commit');
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(800);
        await page.keyboard.type('main');
        await page.waitForTimeout(700);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2500);
        await runCommand('GitHawk: Expand All Files');
        await page.waitForTimeout(1000);
        await runCommand('View: Toggle Maximized Panel');
        await page.waitForTimeout(1500);
        // Bring GitHawk's own sidebar forward: the palette can leave the
        // Explorer in front, and it has a README.md row of its own.
        await runCommand('GitHawk: Open Changes Sidebar');
        await page.waitForTimeout(1000);

        // Open a file from the Files tree, so the read-only editor is in shot too.
        await page
            .locator('#workbench\\.view\\.extension\\.gitHawkSidebar .monaco-list-row', {
                hasText: 'config.ts',
            })
            .first()
            .click();
        await page.waitForTimeout(2000);
        await capture('files-at-commit');
    }

    if (scenes === 'review') {
        /*
         * Review mode, driven from the keyboard the way it is meant to be
         * used. Wants ./scripts/makeReviewSample.sh: uncommitted work with
         * several hunks in one file, one in another, and a new file.
         */
        const chord = async (key) => {
            await page.keyboard.press('Meta+K');
            await page.keyboard.press(key);
            await page.waitForTimeout(1800);
        };
        // The graph panel is not part of this story; the sidebar and the
        // diff editor are.
        await runCommand('View: Toggle Maximized Panel');
        await runCommand('View: Close Panel');
        await runCommand('GitHawk: Show Uncommitted Changes');
        await page.waitForTimeout(2000);
        await capture('review-01-changes');

        await chord('Shift+R');
        await page.waitForTimeout(1500);
        await capture('review-02-started');

        // Viewed, and on to the next: twice, to the due-date change.
        await chord('Shift+V');
        await capture('review-03-viewed-and-next');
        await chord('Shift+V');

        // A comment on the change the cursor is on, typed into VS Code's own
        // comment widget and saved with Cmd+Enter.
        await chord('Shift+C');
        await page.waitForTimeout(800);
        await page.keyboard.type(
            'A paymentTermsDays of 0 is a real term (due on receipt). Make sure it is not treated as missing, and add a test for it.'
        );
        await page.waitForTimeout(600);
        await capture('review-04-commenting');
        await page.keyboard.press('Meta+Enter');
        await page.waitForTimeout(1500);
        await capture('review-05-commented');

        // The rest of the file at once; it folds away, and the next file opens.
        await chord('Shift+F');
        await page.waitForTimeout(800);
        await capture('review-06-file-viewed');

        // Hand the comments over: the picker, then the session it started.
        await chord('Shift+S');
        await page.waitForSelector('.quick-input-widget:visible');
        await page.waitForTimeout(1000);
        await capture('review-07-send-picker');
        await page.keyboard.type('demo-agent');
        await page.waitForTimeout(600);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
        await capture('review-08-sent');

        // The agent acts on it, from outside the editor: the hunk it rewrote
        // comes back unviewed; everything it left alone stays ticked.
        const invoice = join(repo, 'src/billing/invoice.ts');
        writeFileSync(
            invoice,
            readFileSync(invoice, 'utf8').replace(
                'due.setDate(due.getDate() + (invoice.paymentTermsDays ?? 30));',
                'const terms = invoice.paymentTermsDays;\n    due.setDate(due.getDate() + (terms === undefined ? 30 : terms));'
            )
        );
        await page.waitForTimeout(4000);
        await runCommand('View: Close Panel');
        // Straight to the rewritten hunk, from its row.
        await page
            .locator('#workbench\\.view\\.extension\\.gitHawkSidebar .monaco-list-row', {
                hasText: 'Lines 35',
            })
            .first()
            .click();
        await page.waitForTimeout(2000);
        await capture('review-09-after-agent');

        // Leave it for a commit in the graph; the review waits, and resumes.
        await runCommand('GitHawk: Open Git Graph');
        await page.waitForTimeout(2500);
        // The commit box is a webview too, so the graph is whichever one has rows.
        const webviews = page.locator('iframe.webview');
        let graphRows;
        for (let index = 0; index < (await webviews.count()); index++) {
            const candidate = webviews
                .nth(index)
                .contentFrame()
                .locator('iframe#active-frame')
                .contentFrame()
                .getByTestId('git-graph')
                .locator('button');
            if ((await candidate.count()) > 0) {
                graphRows = candidate;
                break;
            }
        }
        await click(graphRows.last());
        await page.waitForTimeout(2500);
        await capture('review-10-paused');
        await runCommand('GitHawk: Resume Code Review');
        await page.waitForTimeout(2500);
        await capture('review-11-resumed');
    }

    if (scenes === 'review-buttons') {
        /*
         * Where the comment buttons are, ringed in red. A row's button shows
         * only while the row is selected or hovered, so one is selected.
         */
        await runCommand('View: Toggle Maximized Panel');
        await runCommand('View: Close Panel');
        await runCommand('GitHawk: Show Uncommitted Changes');
        await page.keyboard.press('Meta+K');
        await page.keyboard.press('Shift+R');
        await page.waitForTimeout(3000);

        // Annotations are drawn into the workbench itself, so no image tool
        // is needed; each is a ring and a label, and ignores the mouse.
        const ring = (selectorScript, label, side = 'left', below = true) =>
            page.evaluate(
                ({ selectorScript, label, side, below }) => {
                    const element = new Function(selectorScript)();
                    if (!element) {
                        return false;
                    }
                    const box = element.getBoundingClientRect();
                    const mark = document.createElement('div');
                    mark.className = 'shot-annotation';
                    Object.assign(mark.style, {
                        position: 'fixed', left: `${box.left - 5}px`, top: `${box.top - 5}px`,
                        width: `${box.width + 10}px`, height: `${box.height + 10}px`,
                        border: '3px solid #ff3b30', borderRadius: '6px', zIndex: 100000,
                        pointerEvents: 'none',
                    });
                    const text = document.createElement('div');
                    text.className = 'shot-annotation';
                    text.textContent = label;
                    Object.assign(text.style, {
                        position: 'fixed',
                        top: below ? `${box.bottom + 10}px` : `${box.top - 36}px`,
                        background: '#ff3b30', color: 'white', font: '600 13px -apple-system, sans-serif',
                        padding: '4px 8px', borderRadius: '4px', zIndex: 100000, pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        ...(side === 'right'
                            ? { right: `${window.innerWidth - box.right - 5}px` }
                            : { left: `${box.left - 5}px` }),
                    });
                    document.body.append(mark, text);
                    return true;
                },
                { selectorScript, label, side, below }
            );

        // 1. A hunk's row, selected — which is when VS Code shows its button.
        await page
            .locator('#workbench\\.view\\.extension\\.gitHawkSidebar .monaco-list-row', { hasText: 'Line 35' })
            .first()
            .click();
        await page.waitForTimeout(2000);
        const found = {
            row: await ring(
                `return [...document.querySelectorAll('.monaco-list-row')].find((r) => r.textContent.includes('Line 35'))?.querySelector('.codicon-comment');`,
                '① Comment on this change — the button on its row (selected or hovered)'
            ),
            title: await ring(
                `return document.querySelector('.editor-group-container.active .editor-actions .codicon-comment');`,
                '② Comment on the change at the cursor',
                'right'
            ),
        };
        console.log('buttons found:', JSON.stringify(found));
        await page.waitForTimeout(400);
        await capture('comment-buttons');
    }

    if (scenes === 'review-multi') {
        /*
         * Two reviews at once, on the committed sample: one commit, then
         * another — the Reviews view lists both — with the buttons each
         * change carries in the diff. Red rings mark what is new.
         */
        const annotate = (selectorScript, label, side = 'left') =>
            page.evaluate(
                ({ selectorScript, label, side }) => {
                    const element = new Function(selectorScript)();
                    if (!element) {
                        return false;
                    }
                    const box = element.getBoundingClientRect();
                    const mark = document.createElement('div');
                    mark.className = 'shot-annotation';
                    Object.assign(mark.style, {
                        position: 'fixed', left: `${box.left - 4}px`, top: `${box.top - 4}px`,
                        width: `${box.width + 8}px`, height: `${box.height + 8}px`,
                        border: '3px solid #ff3b30', borderRadius: '6px', zIndex: 100000,
                        pointerEvents: 'none',
                    });
                    const text = document.createElement('div');
                    text.className = 'shot-annotation';
                    text.textContent = label;
                    Object.assign(text.style, {
                        position: 'fixed', top: `${box.bottom + 8}px`, background: '#ff3b30',
                        color: 'white', font: '600 13px -apple-system, sans-serif', padding: '4px 8px',
                        borderRadius: '4px', zIndex: 100000, pointerEvents: 'none', whiteSpace: 'nowrap',
                        ...(side === 'right'
                            ? { right: `${window.innerWidth - box.right - 4}px` }
                            : { left: `${box.left - 4}px` }),
                    });
                    document.body.append(mark, text);
                    return true;
                },
                { selectorScript, label, side }
            );
        const clear = () =>
            page.evaluate(() => document.querySelectorAll('.shot-annotation').forEach((el) => el.remove()));
        const row = (text) => rows.filter({ hasText: text }).first();

        await runCommand('View: Toggle Maximized Panel');
        await click(row('Payment terms'));
        await page.waitForTimeout(2500);
        await page.keyboard.press('Meta+K');
        await page.keyboard.press('Shift+R');
        await page.waitForTimeout(3500);
        await runCommand('View: Close Panel');
        await page.waitForTimeout(1500);
        console.log('codelens:', await annotate(
            `return [...document.querySelectorAll('.editor.modified .codelens-decoration')].find((d) => d.textContent.includes('Comment') && d.getBoundingClientRect().height > 0);`,
            'Buttons on each change: Comment · Mark viewed'
        ));
        await capture('multi-01-codelens');
        await clear();

        // Another commit: not under review, so its title bar offers to start one.
        await runCommand('GitHawk: Open Git Graph');
        await page.waitForTimeout(1500);
        // On the hash, at the row's left: the branch badge on this row is a
        // button of its own and opens the branch menu.
        await click(row('List overdue'), { position: { x: 40, y: 10 } });
        await page.waitForTimeout(2500);
        console.log('start:', await annotate(
            `return document.querySelector('#workbench\\\\.view\\\\.extension\\\\.gitHawkSidebar .pane-header .codicon-checklist');`,
            'Start a review of this commit',
            'right'
        ));
        await capture('multi-02-start-another');
        await clear();

        await page.keyboard.press('Meta+K');
        await page.keyboard.press('Shift+R');
        await page.waitForTimeout(3500);
        console.log('list:', await annotate(
            `return [...document.querySelectorAll('.pane')].find((p) => p.querySelector('.pane-header')?.textContent.includes('Reviews'));`,
            'Every review in progress — click one to return to it'
        ));
        await capture('multi-03-reviews-list');
    }

    if (scenes === 'review-commits') {
        /*
         * Reviewing history rather than work in progress: the two commits of
         * a feature branch, selected in the graph the way a pull request's
         * commits would be. Wants `makeReviewSample.sh <dir> --committed`.
         */
        const chord = async (key) => {
            await page.keyboard.press('Meta+K');
            await page.keyboard.press(key);
            await page.waitForTimeout(1800);
        };
        const row = (text) => rows.filter({ hasText: text }).first();
        await click(row('List overdue'));
        await page.waitForTimeout(800);
        await click(row('Payment terms'), { modifiers: ['Shift'] });
        await page.waitForTimeout(3000);
        await capture('commits-01-selected');

        await runCommand('View: Close Panel');
        await chord('Shift+R');
        await page.waitForTimeout(1500);
        await capture('commits-02-review-started');

        await chord('Shift+V');
        await chord('Shift+V');
        await chord('Shift+C');
        await page.waitForTimeout(800);
        await page.keyboard.type('Terms of 0 days mean due on receipt; ?? keeps that, but add a test so nobody turns it into ||.');
        await page.keyboard.press('Meta+Enter');
        await page.waitForTimeout(1500);
        await capture('commits-03-commented');

        await chord('Shift+S');
        await page.waitForSelector('.quick-input-widget:visible');
        await page.keyboard.type('demo-agent');
        await page.waitForTimeout(600);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(4000);
        await capture('commits-04-sent');
    }

    console.log(JSON.stringify({ shots }, null, 2));
} catch (error) {
    console.error('capture failed:', error instanceof Error ? error.message : error);
    await capture('99-failure-state');
    process.exitCode = 1;
} finally {
    await app.close();
}
