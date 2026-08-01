const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const menu = (hash) =>
    vscode.commands.executeCommand('gitHawk.commitMenuEntries', hash);

suite('commit menu', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('offers to show the commit’s changes in the sidebar, first', async () => {
        const { separators, labels } = await menu(git(['rev-parse', 'HEAD']));

        assert.equal(separators[0], 'Compare');
        assert.match(labels[0], /Show changes in the sidebar/);
    });

    test('shows them, and puts the view in front', async () => {
        const hash = git(['rev-parse', 'HEAD']);

        // The same path the menu entry takes.
        await vscode.commands.executeCommand('gitHawk.compareCommits', [hash]);
        const comparison = await vscode.commands.executeCommand(
            'gitHawk.lastComparison'
        );

        assert.ok(comparison, 'the Changes view was left empty');
        assert.equal(comparison.method, 'singleCommit');
        assert.ok(
            comparison.files.length > 0,
            `the commit changed no files: ${JSON.stringify(comparison)}`
        );
    });

    test('reports a commit that is no longer in the loaded history', async () => {
        assert.equal(await menu('0'.repeat(40)), undefined);
    });
});
