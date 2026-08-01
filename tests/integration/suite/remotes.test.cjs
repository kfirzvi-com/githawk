const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const remotes = () => vscode.commands.executeCommand('gitHawk.remotes');

suite('remotes', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('registers the command', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('gitHawk.manageRemotes'));
    });

    test('reads the remote the sample repository actually has', async () => {
        const listed = await remotes();

        assert.deepEqual(
            listed.map((r) => r.name),
            ['origin']
        );
        assert.equal(listed[0].fetchUrl, `${root()}-remote`);
    });

    test('sees a remote added and removed outside GitHawk', async () => {
        git(['remote', 'add', 'mirror', 'https://example.com/mirror.git']);
        try {
            const listed = await remotes();
            const mirror = listed.find((r) => r.name === 'mirror');

            assert.ok(mirror, `mirror missing from ${JSON.stringify(listed)}`);
            assert.equal(mirror.fetchUrl, 'https://example.com/mirror.git');
        } finally {
            git(['remote', 'remove', 'mirror']);
        }

        assert.ok(!(await remotes()).some((r) => r.name === 'mirror'));
    });
});
