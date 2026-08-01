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

    test('shows tracked changes against HEAD', async () => {
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const comparison = await vscode.commands.executeCommand(
            'gitHawk.lastComparison'
        );

        assert.ok(comparison, 'nothing reached the Changes view');
        assert.match(comparison.label, /working tree/);
        assert.ok(
            comparison.files.length > 0,
            `the sample repository is dirty, so this should not be empty: ${JSON.stringify(comparison)}`
        );
    });

    /**
     * Pinned deliberately, because it is the one place the row's summary and
     * its changeset disagree. `git diff HEAD` cannot show a file git has never
     * seen — there is no blob to diff against — so an untracked file is counted
     * in the row and absent from the comparison. The row says so in its
     * tooltip; changing it means teaching the comparer to synthesise an
     * addition, which is a bigger change than it looks.
     */
    test('untracked files are counted but not diffed', async () => {
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

            assert.ok(
                !comparison.files.some((f) =>
                    f.endsWith('uncommitted-probe.txt')
                ),
                'the comparison now includes untracked files — update the row’s tooltip and the README, which both say it does not'
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
