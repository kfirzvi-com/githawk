/**
 * The tier that can answer "does the watcher actually fire?".
 *
 * Neither of the others can: Vitest has no extension host to install a
 * FileSystemWatcher in, and the Playwright harness has no git. A watcher that
 * silently never fires looks exactly like a watcher that works until someone
 * commits in a terminal.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const snapshot = () => vscode.commands.executeCommand('gitHawk.graphSnapshot');

/** Polls rather than sleeps: the debounce makes the timing deliberately loose. */
async function waitFor(predicate, description, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let last;

    while (Date.now() < deadline) {
        last = await snapshot();
        if (predicate(last)) {
            return last;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.fail(
        `timed out waiting for ${description}; last snapshot was ${JSON.stringify(last)}`
    );
}

suite('refreshing when the repository changes underneath', () => {
    suiteSetup(async function () {
        this.timeout(60_000);
        await vscode.extensions.getExtension(EXTENSION_ID).activate();

        // The graph only reloads while the panel exists, so the panel is part
        // of what is under test.
        await vscode.commands.executeCommand('gitHawk.open');
        await waitFor((s) => s !== undefined, 'the first graph to load');
    });

    test('picks up a commit made outside GitHawk', async function () {
        this.timeout(40_000);
        const before = await snapshot();

        git(['commit', '--quiet', '--allow-empty', '-m', 'made in a terminal']);
        const head = git(['rev-parse', 'HEAD']);

        const after = await waitFor(
            (s) => s?.head === head,
            'the new commit to reach the graph'
        );

        assert.equal(after.commits, before.commits + 1);
    });

    test('picks up a branch created outside GitHawk', async function () {
        this.timeout(40_000);
        const before = await snapshot();

        // No commit, so only a ref file changes — the case a HEAD-only watcher
        // would miss.
        git(['branch', 'made-outside-githawk']);

        await waitFor(
            (s) => s.loads > before.loads,
            'a reload after the branch was created'
        );
    });

    test('coalesces a burst into one reload', async function () {
        this.timeout(40_000);
        const before = await snapshot();

        for (let i = 0; i < 5; i++) {
            git(['branch', `burst-${i}`]);
        }

        await waitFor(
            (s) => s.loads > before.loads,
            'a reload after the burst'
        );
        // Let anything still pending settle before counting.
        await new Promise((resolve) => setTimeout(resolve, 3_000));

        const after = await snapshot();
        assert.ok(
            after.loads - before.loads <= 3,
            `five ref writes caused ${after.loads - before.loads} reloads; the debounce is not coalescing`
        );
    });
});
