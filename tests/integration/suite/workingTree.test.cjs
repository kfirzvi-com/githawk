/**
 * Only this tier has real git. The Playwright harness fakes the status, so it
 * can show that the row renders but not that the counts are true.
 *
 * Everything here works on the shared sample repository and must leave it
 * exactly as it found it — a test that rewrites its history takes the rest of
 * the suite down with it.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

suite('uncommitted changes', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    /**
     * The reason this row is not treated like a commit. Browsing the graph is
     * many clicks across many commits, so the sidebar is surfaced once and then
     * left alone; there is exactly one working-tree row and nothing to browse
     * through, so every click on it is a request to see the files.
     */
    test('brings the sidebar to the front every time, not just the first', async () => {
        const before = await vscode.commands.executeCommand(
            'gitHawk.changesRevealed'
        );

        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const once = await vscode.commands.executeCommand(
            'gitHawk.changesRevealed'
        );
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const twice = await vscode.commands.executeCommand(
            'gitHawk.changesRevealed'
        );

        assert.equal(once, before + 1, 'the first selection did not reveal');
        assert.equal(twice, once + 1, 'the second selection did not reveal');
    });

    test('shows tracked changes against HEAD', async () => {
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const comparison = await vscode.commands.executeCommand(
            'gitHawk.lastComparison'
        );

        assert.ok(comparison, 'nothing reached the Changes view');
        assert.match(comparison.label, /Uncommitted changes/);
        assert.ok(
            comparison.files.length > 0,
            `the sample repository is dirty, so this should not be empty: ${JSON.stringify(comparison)}`
        );
    });

    /**
     * Untracked files used to be counted in the row and absent from the
     * changeset — `git diff HEAD` has no blob for a file git has never seen.
     * The working tree is now read in git's own sections, and the untracked
     * one is listed from `ls-files --others`, so the row and the tree agree.
     */
    test('untracked files are counted and listed', async () => {
        const scratch = join(root(), 'uncommitted-probe.txt');
        writeFileSync(scratch, 'not committed\n');

        try {
            const status = await vscode.commands.executeCommand(
                'gitHawk.workingTree'
            );
            assert.ok(
                status.untracked >= 1,
                `the row would not mention it: ${JSON.stringify(status)}`
            );

            await vscode.commands.executeCommand(
                'gitHawk.showUncommittedChanges'
            );
            const comparison = await vscode.commands.executeCommand(
                'gitHawk.lastComparison'
            );

            assert.equal(comparison.method, 'workingTree');
            assert.ok(
                comparison.files.some((f) => f.endsWith('uncommitted-probe.txt')),
                `the untracked file is missing from ${JSON.stringify(comparison.files)}`
            );
        } finally {
            rmSync(scratch, { force: true });
        }
    });

    test('reports what git reports', async () => {
        const scratch = join(root(), 'counted.txt');
        writeFileSync(scratch, 'staged content\n');
        git(['add', 'counted.txt']);

        try {
            const status = await vscode.commands.executeCommand(
                'gitHawk.workingTree'
            );

            assert.ok(status.staged >= 1, JSON.stringify(status));
            // Cross-checked against git itself rather than against a number
            // written into this test.
            const untracked = git(['status', '--porcelain'])
                .split('\n')
                .filter((line) => line.startsWith('??')).length;
            assert.equal(status.untracked, untracked);
        } finally {
            git(['rm', '--force', '--quiet', 'counted.txt']);
        }
    });
});
