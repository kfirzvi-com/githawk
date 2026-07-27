const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');

const EXTENSION_ID = 'kfirzvi.githawk';

const git = (args) =>
    execFileSync('git', args, {
        cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
        encoding: 'utf8',
    }).trim();

/** Waits for a condition, since comparisons are asynchronous. */
async function eventually(describe, predicate, timeoutMs = 30_000) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
        try {
            last = await predicate();
            if (last) {
                return last;
            }
        } catch (error) {
            last = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`timed out waiting for ${describe} (last: ${last})`);
}

suite('GitHawk in a real extension host', () => {
    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} not found`);
        await extension.activate();
    });

    test('activates and registers its commands', async () => {
        const commands = await vscode.commands.getCommands(true);

        for (const expected of [
            'gitHawk.open',
            'gitHawk.refresh',
            'gitHawk.compareCommits',
            'gitHawk.openChangedFile',
            'gitHawk.clearChanges',
        ]) {
            assert.ok(
                commands.includes(expected),
                `${expected} was not registered`
            );
        }
    });

    test('the sample workspace is the repository under test', () => {
        assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/reporting');
        assert.ok(Number(git(['rev-list', '--count', '--all'])) > 10);
    });

    /*
     * The regression this tier was built for: comparing several commits worked in
     * Node and in the browser harness but produced nothing in VS Code.
     */
    test('comparing several commits produces a comparison', async () => {
        const hashes = git(['log', '--format=%H', '-n', '4']).split('\n');
        const selection = [hashes[0], hashes[2]];

        await vscode.commands.executeCommand('gitHawk.compareCommits', selection);

        // The command resolves before the comparison finishes, so poll.
        await eventually('the Changes view to report files', async () => {
            const output = await comparisonSummary();
            return output && output.files > 0 ? output : undefined;
        });
    });

    test('comparing a selection that includes a merge commit still succeeds', async () => {
        const merge = git(['rev-list', '--all', '--merges', '-n', '1']);
        const spike = git(['rev-parse', 'spike/graphql']);

        await vscode.commands.executeCommand('gitHawk.compareCommits', [
            spike,
            merge,
        ]);

        const summary = await eventually(
            'a comparison including a merge commit',
            async () => {
                const output = await comparisonSummary();
                return output ? output : undefined;
            }
        );

        // A merge commit cannot be replayed, but it must not sink the comparison.
        assert.ok(summary.files >= 1, 'expected at least one changed file');
    });

    test('comparing a single commit produces its own changes', async () => {
        const head = git(['rev-parse', 'HEAD']);

        await vscode.commands.executeCommand('gitHawk.compareCommits', [head]);

        const summary = await eventually('a single-commit comparison', async () => {
            const output = await comparisonSummary();
            return output && output.files > 0 ? output : undefined;
        });

        assert.ok(summary.files > 0);
    });

    /** Asks the extension what is in the Changes view right now. */
    async function comparisonSummary() {
        const current = await vscode.commands.executeCommand(
            'gitHawk.lastComparison'
        );
        return current ? { ...current, files: current.files.length } : undefined;
    }
});
