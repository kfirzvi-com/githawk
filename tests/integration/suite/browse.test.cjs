const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const run = (command, ...args) =>
    vscode.commands.executeCommand(command, ...args);

/** Every file row beneath the given rows, in tree order. */
function filesBeneath(nodes) {
    return nodes.flatMap((node) =>
        node.kind === 'file' ? [node] : filesBeneath(node.children)
    );
}

suite('browsing the files at a commit', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    teardown(() => run('gitHawk.closeFiles'));

    test('the commit menu offers it, after the comparisons', async () => {
        const { separators, labels } = await run(
            'gitHawk.commitMenuEntries',
            git(['rev-parse', 'HEAD'])
        );

        assert.equal(separators[1], 'Browse');
        assert.ok(
            labels.some((label) => /Browse files at this commit/.test(label)),
            `not offered: ${labels.join(', ')}`
        );
    });

    test('shows every file git has at that commit, not only the changed ones', async () => {
        // An older commit, so the tree differs from the working tree.
        const hash = git(['rev-parse', 'HEAD~3']);
        const expected = git(['ls-tree', '-r', '--name-only', hash])
            .split('\n')
            .filter(Boolean)
            .sort();

        await run('gitHawk.browseCommit', hash);

        const browsed = await run('gitHawk.browsedRevision');
        assert.ok(browsed, 'the Files view was left empty');
        assert.equal(browsed.hash, hash);
        assert.deepEqual([...browsed.paths].sort(), expected);

        const rows = filesBeneath(await run('gitHawk.filesTree'));
        assert.deepEqual(rows.map((row) => row.path).sort(), expected);
        assert.ok(rows.every((row) => row.rev === hash), 'a row names another commit');
    });

    test('resolves a branch name to the commit it points at', async () => {
        await run('gitHawk.browseCommit', 'main');

        const browsed = await run('gitHawk.browsedRevision');
        assert.equal(browsed.hash, git(['rev-parse', 'main']));
    });

    test('a row opens that commit’s version of the file, read-only', async () => {
        const hash = git(['rev-parse', 'HEAD~3']);
        await run('gitHawk.browseCommit', hash);
        const [row] = filesBeneath(await run('gitHawk.filesTree'));

        const opened = await run('gitHawk.openFileAtRevision', row);

        const uri = vscode.Uri.parse(opened);
        assert.equal(uri.scheme, 'githawk-rev');
        assert.equal(uri.query, hash);
        assert.equal(uri.path, `/${row.path}`);

        const editor = vscode.window.activeTextEditor;
        assert.ok(editor, 'nothing was opened');
        assert.equal(editor.document.uri.toString(), opened);
        assert.equal(
            editor.document.getText(),
            execFileSync('git', ['show', `${hash}:${row.path}`], {
                cwd: root(),
                encoding: 'utf8',
            })
        );
    });

    test('closing empties the view', async () => {
        await run('gitHawk.browseCommit', git(['rev-parse', 'HEAD']));
        assert.ok(await run('gitHawk.browsedRevision'));

        await run('gitHawk.closeFiles');

        assert.equal(await run('gitHawk.browsedRevision'), undefined);
        assert.deepEqual(await run('gitHawk.filesTree'), []);
    });

    test('refuses a name that is not a revision, and keeps what it had', async () => {
        const hash = git(['rev-parse', 'HEAD']);
        await run('gitHawk.browseCommit', hash);

        await run('gitHawk.browseCommit', 'no-such-revision');

        const browsed = await run('gitHawk.browsedRevision');
        assert.equal(browsed && browsed.hash, hash);
    });
});
