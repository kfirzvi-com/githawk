const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const worktrees = () => vscode.commands.executeCommand('gitHawk.worktrees');
const menu = (name, isRemote = false) =>
    vscode.commands.executeCommand('gitHawk.branchMenuEntries', name, isRemote);

suite('worktrees', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('lists the sample repository’s worktrees, main one first', async () => {
        const found = await worktrees();

        assert.equal(found.length, 3, JSON.stringify(found, null, 2));
        assert.equal(found[0].isMain, true);
        assert.equal(found[0].isCurrent, true);
        // The workspace is the main worktree, so it is the one being read.
        assert.equal(found[0].branch, 'feature/reporting');
    });

    test('reports a worktree whose directory was deleted as missing', async () => {
        const found = await worktrees();
        const stale = found.find((worktree) => worktree.isPrunable);

        assert.ok(stale, 'expected one prunable worktree in the sample');
        assert.equal(stale.branch, 'spike/abandoned');
    });

    test('describes what each worktree has checked out', async () => {
        const found = await worktrees();
        const handbook = found.find((worktree) =>
            worktree.name.endsWith('-handbook')
        );

        assert.ok(handbook, JSON.stringify(found.map((w) => w.name)));
        assert.equal(handbook.checkedOut, 'docs/handbook');
    });

    /*
     * The reason this feature exists. Git allows a branch in one working tree at
     * a time, and its refusal names a path without explaining the rule — so the
     * checkout entry must be replaced rather than left to fail.
     */
    test('offers no checkout for a branch checked out in another worktree', async () => {
        const { separators, labels } = await menu('docs/handbook');
        const shown = JSON.stringify({ separators, labels }, null, 2);

        assert.ok(!separators.includes('Check out'), shown);
        assert.ok(
            !labels.some((label) => /Check out docs\/handbook/.test(label)),
            shown
        );
        assert.ok(separators.includes('Worktree'), shown);
        assert.ok(
            labels.some((label) => /Open the worktree/.test(label)),
            shown
        );
    });

    test('git really does refuse that checkout', () => {
        // Asserting the premise, not just the UI's belief about it.
        assert.throws(() => git(['checkout', 'docs/handbook']));
        assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/reporting');
    });

    test('a stale record blocks the checkout just as a live one does', async () => {
        // The directory is gone, but git goes by the record until it is pruned.
        const { separators, labels } = await menu('spike/abandoned');

        assert.ok(!separators.includes('Check out'));
        assert.ok(labels.some((label) => /Open the worktree/.test(label)));
        assert.throws(() => git(['checkout', 'spike/abandoned']));
    });

    test('offers to create a worktree for a branch that is free', async () => {
        const { separators, labels } = await menu('main');
        const shown = JSON.stringify({ separators, labels }, null, 2);

        assert.ok(separators.includes('Check out'), shown);
        assert.ok(separators.includes('Worktree'), shown);
        assert.ok(
            labels.some((label) => /Create a worktree for main/.test(label)),
            shown
        );
    });

    test('offers no worktree entries for a remote branch', async () => {
        // A worktree checks out a local branch; a remote ref has to be tracked
        // first, which is what the Check out group already offers.
        const { labels } = await menu('origin/main', true);

        assert.ok(!labels.some((label) => /worktree/i.test(label)));
    });

    test('the manager lists every worktree with its launch buttons', async () => {
        const { labels, buttonCounts } = await vscode.commands.executeCommand(
            'gitHawk.worktreeItems'
        );

        assert.ok(labels.some((label) => label.includes('Create a worktree')));
        assert.ok(labels.some((label) => /Prune 1 stale record/.test(label)));
        // New window, terminal, AI CLI — but not on a worktree whose directory
        // is gone, where all three would fail.
        assert.deepEqual(buttonCounts.slice().sort(), [0, 3, 3]);
    });

    test('the current worktree is marked in the manager', async () => {
        const { labels } = await vscode.commands.executeCommand(
            'gitHawk.worktreeItems'
        );

        assert.equal(
            labels.filter((label) => label.includes('$(check)')).length,
            1
        );
    });

    test('registers the worktree commands', async () => {
        const commands = await vscode.commands.getCommands(true);

        for (const expected of [
            'gitHawk.manageWorktrees',
            'gitHawk.startAiTool',
        ]) {
            assert.ok(commands.includes(expected), `${expected} missing`);
        }
    });
});
