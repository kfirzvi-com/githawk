/**
 * Staging, unstaging and committing from the Changes view, against real git.
 *
 * Driven through the tree's own rows — `gitHawk.changesTree` returns what the
 * view is showing — rather than rows the test built, so a row the view forgot
 * to offer is a failure here rather than a pass.
 *
 * Every test puts the sample repository back as it found it: files it makes
 * are removed, and a commit it makes is undone with a soft reset that leaves
 * nothing behind.
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

/** The section of the tree, as the view has it, or undefined when absent. */
async function section(kind) {
    await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
    const roots = await vscode.commands.executeCommand('gitHawk.changesTree');
    return roots.find((node) => node.kind === 'group' && node.group === kind);
}

/** Every file row under a node, flat. */
function rows(node) {
    if (!node) {
        return [];
    }
    return node.kind === 'file' ? [node] : node.children.flatMap(rows);
}

async function eventually(describe, predicate, timeoutMs = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (await predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`timed out waiting for ${describe}`);
}

suite('commit from the Changes view', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('the working tree is sectioned, untracked files included', async () => {
        const scratch = join(root(), 'commit-probe-untracked.txt');
        writeFileSync(scratch, 'new\n');

        try {
            const untracked = await section('untracked');
            assert.ok(untracked, 'no Untracked Files section');
            const row = rows(untracked).find((r) =>
                r.change.path.endsWith('commit-probe-untracked.txt')
            );
            assert.ok(row, 'the new file is not in the tree');
            assert.equal(row.change.status, 'untracked');
            assert.equal(row.group, 'untracked');
            // An untracked file has no HEAD side, and the disk on the right.
            assert.equal(row.baseRev, 'HEAD');
            assert.equal(row.targetRev, undefined);
        } finally {
            rmSync(scratch, { force: true });
        }
    });

    test('stages and unstages a file through its own row', async () => {
        const scratch = join(root(), 'commit-probe-stage.txt');
        writeFileSync(scratch, 'to be staged\n');

        try {
            const untrackedRow = rows(await section('untracked')).find((r) =>
                r.change.path.endsWith('commit-probe-stage.txt')
            );
            assert.ok(untrackedRow, 'the file is not offered for staging');

            await vscode.commands.executeCommand('gitHawk.stage', untrackedRow);
            assert.match(git(['status', '--porcelain', '--', 'commit-probe-stage.txt']), /^A /);

            // Now in the staged section, with the index as its right side.
            await eventually('the tree to show it as staged', async () =>
                rows(await section('staged')).some((r) =>
                    r.change.path.endsWith('commit-probe-stage.txt')
                )
            );
            const stagedRow = rows(await section('staged')).find((r) =>
                r.change.path.endsWith('commit-probe-stage.txt')
            );
            assert.equal(stagedRow.targetRev, ':0');
            assert.equal(stagedRow.baseRev, 'HEAD');

            await vscode.commands.executeCommand('gitHawk.unstage', stagedRow);
            assert.match(git(['status', '--porcelain', '--', 'commit-probe-stage.txt']), /^\?\? /);
        } finally {
            git(['reset', '-q', '--', 'commit-probe-stage.txt']);
            rmSync(scratch, { force: true });
        }
    });

    test('staging a section stages everything beneath it', async () => {
        const one = join(root(), 'commit-probe-a.txt');
        const two = join(root(), 'commit-probe-b.txt');
        writeFileSync(one, 'a\n');
        writeFileSync(two, 'b\n');

        try {
            const untracked = await section('untracked');
            await vscode.commands.executeCommand('gitHawk.stage', untracked);

            const status = git(['status', '--porcelain']);
            assert.match(status, /^A  commit-probe-a\.txt$/m);
            assert.match(status, /^A  commit-probe-b\.txt$/m);
        } finally {
            git(['reset', '-q', '--', 'commit-probe-a.txt', 'commit-probe-b.txt']);
            rmSync(one, { force: true });
            rmSync(two, { force: true });
        }
    });

    test('a commit records exactly what was staged, with the message given', async () => {
        const head = git(['rev-parse', 'HEAD']);
        const scratch = join(root(), 'commit-probe-commit.txt');
        writeFileSync(scratch, 'committed from the view\n');
        git(['add', 'commit-probe-commit.txt']);
        // The sample repository keeps something staged of its own; the commit
        // must take all of the index and none of the rest.
        const staged = git(['diff', '--cached', '--name-only']).split('\n').sort();
        assert.ok(staged.includes('commit-probe-commit.txt'));

        try {
            const message = 'Probe the commit box\n\nA body line, kept intact.';
            const committed = await vscode.commands.executeCommand(
                'gitHawk.commitForTesting',
                message
            );
            assert.equal(committed, true, 'the commit did not happen');

            assert.notEqual(git(['rev-parse', 'HEAD']), head);
            assert.equal(git(['log', '-1', '--format=%B']).trim(), message);
            assert.deepEqual(
                git(['show', '--name-only', '--format=', 'HEAD']).split('\n').sort(),
                staged
            );
        } finally {
            git(['reset', '-q', '--soft', head]);
            git(['reset', '-q', '--', 'commit-probe-commit.txt']);
            rmSync(scratch, { force: true });
        }
    });

    /**
     * From a diff GitHawk opened to the file in the Explorer. The historical
     * side is a `githawk-rev` document with a path and no location; the
     * command has to join it to the repository. Asserted on what the command
     * resolved to, because the Explorer's selection cannot be read back.
     */
    test('reveals the file behind a historical diff document', async () => {
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const roots = await vscode.commands.executeCommand('gitHawk.changesTree');
        const staged = roots.find((node) => node.kind === 'group' && node.group === 'staged');
        const row = rows(staged)[0];
        assert.ok(row, 'the sample repository keeps something staged');

        // The staged side of the diff: the index, not the disk.
        const historical = vscode.Uri.from({
            scheme: 'githawk-rev',
            path: `/${row.change.path}`,
            query: row.targetRev,
        });
        const revealed = await vscode.commands.executeCommand(
            'gitHawk.revealInExplorer',
            historical
        );

        assert.equal(revealed, join(root(), row.change.path));
    });

    test('reveals a row of the Changes tree', async () => {
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');
        const roots = await vscode.commands.executeCommand('gitHawk.changesTree');
        const row = roots.flatMap(rows)[0];

        const revealed = await vscode.commands.executeCommand(
            'gitHawk.revealChangedFileInExplorer',
            row
        );

        assert.equal(revealed, join(root(), row.change.path));
    });

    test('says so rather than revealing a file that is not on disk', async () => {
        const revealed = await vscode.commands.executeCommand(
            'gitHawk.revealInExplorer',
            vscode.Uri.from({ scheme: 'githawk-rev', path: '/no/such/file.txt', query: 'HEAD' })
        );

        assert.equal(revealed, undefined);
    });

    test('refuses an empty message rather than letting git do it', async () => {
        const head = git(['rev-parse', 'HEAD']);
        const committed = await vscode.commands.executeCommand(
            'gitHawk.commitForTesting',
            '   '
        );

        assert.equal(committed, false);
        assert.equal(git(['rev-parse', 'HEAD']), head);
    });
});
