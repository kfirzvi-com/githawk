/**
 * Blame inside a real extension host.
 *
 * Vitest already covers the parser against real repositories. What only this
 * tier can answer is whether the decorator reaches git at all from inside VS
 * Code — the reader resolves its working directory from the active repository,
 * which does not exist in the other two tiers — and whether the link out of a
 * hover lands where it says it will.
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

const blame = (path) => vscode.commands.executeCommand('gitHawk.blame', path);

suite('blame', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('registers its commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('gitHawk.blame'));
        assert.ok(commands.includes('gitHawk.revealCommit'));
    });

    test('reads a tracked file, in blocks', async () => {
        const blocks = await blame(join(root(), 'README.md'));

        assert.ok(Array.isArray(blocks) && blocks.length > 0);
        for (const block of blocks) {
            assert.ok(block.startLine >= 1);
            assert.ok(block.endLine >= block.startLine);
            assert.ok(block.author.length > 0);
        }
    });

    test('the blocks cover the file once, in order, with no gaps', async () => {
        // The property the column depends on: every line gets exactly one
        // label, so a gap would render as an unannotated hole.
        const blocks = await blame(join(root(), 'README.md'));

        let expected = 1;
        for (const block of blocks) {
            assert.equal(block.startLine, expected, JSON.stringify(block));
            expected = block.endLine + 1;
        }
    });

    test('marks a line that is not committed yet', async () => {
        const path = join(root(), 'README.md');
        const original = execFileSync('git', ['show', 'HEAD:README.md'], {
            cwd: root(),
            encoding: 'utf8',
        });

        writeFileSync(path, `${original}\nan uncommitted line\n`);
        try {
            const blocks = await blame(path);
            const last = blocks[blocks.length - 1];

            assert.equal(last.isUncommitted, true, JSON.stringify(last));
            assert.equal(last.author, 'You');
        } finally {
            git(['checkout', '--', 'README.md']);
        }
    });

    test('reports nothing for a file git has never seen', async () => {
        // Not an error: opening a scratch file is the common case, and the
        // decorator has to do nothing rather than complain.
        const path = join(root(), 'never-tracked.txt');
        writeFileSync(path, 'hello\n');

        try {
            await assert.rejects(() => blame(path));
        } finally {
            rmSync(path, { force: true });
        }
    });

    test('the hover’s link selects the commit and fills the Changes tree', async () => {
        const hash = git(['rev-parse', 'HEAD']);

        await vscode.commands.executeCommand('gitHawk.revealCommit', hash);
        const comparison = await vscode.commands.executeCommand(
            'gitHawk.lastComparison'
        );

        assert.ok(comparison, 'the Changes view was left empty');
        assert.equal(comparison.method, 'singleCommit');
    });
});

suite('turning blame on and off', () => {
    const style = () =>
        vscode.workspace.getConfiguration('gitHawk').get('blame.style');

    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    teardown(async () => {
        await vscode.workspace
            .getConfiguration('gitHawk')
            .update('blame.style', undefined, vscode.ConfigurationTarget.Global);
    });

    test('is off until asked for', () => {
        // The default matters: blame is a thing you flick on to answer one
        // question, not something that should appear unbidden.
        assert.equal(style(), 'off');
    });

    test('the toggle turns it on, and off again', async () => {
        await vscode.commands.executeCommand('gitHawk.toggleBlame');
        assert.equal(style(), 'column');

        await vscode.commands.executeCommand('gitHawk.toggleBlame');
        assert.equal(style(), 'off');
    });

    test('always turns on the column, whatever was set before', async () => {
        /*
         * A switch that lands somewhere different depending on history is not a
         * switch. `endOfLine` stays reachable through the setting; the toggle
         * overwriting it is the price of being predictable.
         */
        await vscode.workspace
            .getConfiguration('gitHawk')
            .update('blame.style', 'endOfLine', vscode.ConfigurationTarget.Global);

        await vscode.commands.executeCommand('gitHawk.toggleBlame');
        assert.equal(style(), 'off');

        await vscode.commands.executeCommand('gitHawk.toggleBlame');
        assert.equal(style(), 'column');
    });
});
