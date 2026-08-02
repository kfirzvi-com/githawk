/**
 * The stash inside a real extension host.
 *
 * Everything here works on the shared sample repository and must leave it as it
 * found it — including the stash itself, which is global to the repository.
 *
 * Which is why every entry made here is scoped to README.md with a pathspec.
 * A bare `git stash push` takes the whole working tree, and the sample is
 * deliberately dirty: stashing it away would quietly clean the repository and
 * break the suites that depend on it being dirty. That is not a hypothetical —
 * it is what the first version of this file did.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const stashes = () => vscode.commands.executeCommand('gitHawk.stashes');

suite('the stash', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    teardown(() => {
        // Anything a test left behind, in case it failed part way.
        while (git(['stash', 'list']).length > 0) {
            git(['stash', 'drop']);
        }
        git(['checkout', '--', 'README.md']);
    });

    /** Scoped to one file the sample leaves clean. See the note above. */
    const stashReadme = (message) => {
        writeFileSync(join(root(), 'README.md'), `${message}\n`);
        git(['stash', 'push', '--message', message, '--', 'README.md']);
    };

    test('registers its commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('gitHawk.manageStashes'));
    });

    test('is empty until something is put aside', async () => {
        assert.deepEqual(await stashes(), []);
    });

    test('sees an entry made outside GitHawk, with its message and branch', async () => {
        const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
        stashReadme('from the test');

        const listed = await stashes();

        assert.equal(listed.length, 1);
        assert.equal(listed[0].message, 'from the test');
        assert.equal(listed[0].branch, branch);
        assert.equal(listed[0].isAutoNamed, false);
        assert.match(listed[0].ref, /^stash@\{0\}$/);
    });

    test('reports the whole stack, newest first', async () => {
        for (const message of ['first aside', 'second aside']) {
            stashReadme(message);
        }

        const listed = await stashes();

        assert.deepEqual(
            listed.map((entry) => entry.message),
            ['second aside', 'first aside']
        );
    });

    test('an entry knows its own commit, which outlives its position', async () => {
        // The property the menu relies on to avoid acting on the wrong entry.
        for (const message of ['keep me', 'drop me']) {
            stashReadme(message);
        }

        const before = await stashes();
        const keep = before.find((entry) => entry.message === 'keep me');
        assert.equal(keep.ref, 'stash@{1}');

        git(['stash', 'drop', 'stash@{0}']);

        const after = await stashes();
        const same = after.find((entry) => entry.hash === keep.hash);
        assert.ok(same, 'the entry lost its identity when another was dropped');
        assert.equal(same.ref, 'stash@{0}', 'the position should have moved');
    });
});
