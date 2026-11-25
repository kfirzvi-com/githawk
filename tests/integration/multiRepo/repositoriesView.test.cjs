const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

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
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`timed out waiting for ${describe} (last: ${JSON.stringify(last)})`);
}

const discovered = () => vscode.commands.executeCommand('gitHawk.repositories');
/** The rows exactly as the view was handed them, and its badge. */
const view = () => vscode.commands.executeCommand('gitHawk.repositoriesTree');
const rowOf = (state, root) => state.rows.find((row) => row.root === root);

/**
 * The Repositories view: every repository in the workspace on one line, kept
 * current without anyone selecting it — and a click on a row is the same as
 * choosing it in the picker.
 */
suite('the Repositories view', () => {
    let web;
    let cli;
    let previouslyActive;

    suiteSetup(async () => {
        const { repositories, activeRoot } = await eventually(
            'the repositories to be found',
            async () => {
                const found = await discovered();
                return found.repositories.length > 1 ? found : undefined;
            }
        );
        previouslyActive = activeRoot;
        web = repositories.find((r) => r.root.endsWith(`${path.sep}web`)).root;
        cli = repositories.find((r) => r.root.endsWith(path.join('tools', 'cli'))).root;
        await vscode.commands.executeCommand('gitHawk.selectRepository', web);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('gitHawk.showCleanRepositories');
        rmSync(path.join(cli, 'from-a-terminal.txt'), { force: true });
        if (previouslyActive) {
            await vscode.commands.executeCommand('gitHawk.selectRepository', previouslyActive);
        }
    });

    test('lists every discovered repository, with the selected one checked', async () => {
        const { repositories } = await discovered();
        const state = await eventually('every row to be read', async () => {
            const current = await view();
            return current.rows.length === repositories.length &&
                current.rows.every((row) => row.state !== 'loading')
                ? current
                : undefined;
        });

        assert.deepEqual(
            state.rows.map((row) => row.root),
            repositories.map((repository) => repository.root)
        );
        assert.equal(rowOf(state, web).icon, 'check');
        assert.equal(rowOf(state, cli).icon, 'repo');
        assert.equal(rowOf(state, web).description, 'main');
        assert.deepEqual(rowOf(state, cli).command, {
            command: 'gitHawk.selectRepository',
            arguments: [cli],
        });
    });

    test('a file written outside the editor shows on its repository’s row, not the selected one', async () => {
        const before = (await view()).badge;
        // Plain fs, as a terminal or an agent would: no save event, no edit.
        writeFileSync(path.join(cli, 'from-a-terminal.txt'), 'hello\n');

        const state = await eventually('the cli row to show the new file', async () => {
            const current = await view();
            return rowOf(current, cli).description === 'main · 1 changed' ? current : undefined;
        });

        assert.equal(rowOf(state, cli).state, 'changed');
        assert.match(rowOf(state, cli).contextValue, /\bchanged\b/);
        assert.equal(state.badge, before + 1);
        // Nothing about it moved the selection.
        assert.equal((await discovered()).activeRoot, web);
    });

    test('a commit made in a terminal clears the row again', async () => {
        git(['add', 'from-a-terminal.txt'], cli);
        git(
            ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'from a terminal'],
            cli
        );

        const state = await eventually('the cli row to be clean', async () => {
            const current = await view();
            return rowOf(current, cli).state === 'clean' ? current : undefined;
        });
        assert.equal(rowOf(state, cli).description, 'main');
        git(['reset', '-q', '--hard', 'HEAD~1'], cli);
    });

    test('clicking a row selects its repository, and the check follows', async () => {
        const row = rowOf(await view(), cli);
        await vscode.commands.executeCommand(row.command.command, ...row.command.arguments);

        assert.equal((await discovered()).activeRoot, cli);
        const state = await eventually('the check to move', async () => {
            const current = await view();
            return rowOf(current, cli).icon === 'check' ? current : undefined;
        });
        assert.equal(rowOf(state, web).icon, 'repo');
        assert.match(rowOf(state, cli).contextValue, /\bselected\b/);

        await vscode.commands.executeCommand('gitHawk.selectRepository', web);
    });

    test('hiding clean repositories keeps the changed ones and the selected one', async () => {
        writeFileSync(path.join(cli, 'from-a-terminal.txt'), 'again\n');
        await eventually('the cli row to change', async () =>
            rowOf(await view(), cli)?.state === 'changed'
        );

        await vscode.commands.executeCommand('gitHawk.hideCleanRepositories');
        const state = await view();

        assert.equal(state.hidesClean, true);
        assert.ok(rowOf(state, cli), 'the changed repository is listed');
        assert.ok(rowOf(state, web), 'the selected repository is listed though clean');
        assert.ok(
            state.rows.every((row) => row.state !== 'clean' || row.root === web),
            `only changed rows besides the selected one: ${JSON.stringify(state.rows.map((r) => [r.root, r.state]))}`
        );

        await vscode.commands.executeCommand('gitHawk.showCleanRepositories');
        assert.equal((await view()).hidesClean, false);
    });

    test('a row’s Commit selects its repository and puts its changes in front of the box', async () => {
        const row = (await view()).rows.find((r) => r.root === cli);
        // VS Code hands an inline action the element itself.
        await vscode.commands.executeCommand('gitHawk.repository.commit', {
            root: row.root,
        });

        assert.equal((await discovered()).activeRoot, cli);
        const tree = await eventually('the Changes view to show cli’s file', async () => {
            const nodes = await vscode.commands.executeCommand('gitHawk.changesTree');
            const json = JSON.stringify(nodes);
            return json.includes('from-a-terminal.txt') ? nodes : undefined;
        });
        assert.ok(tree);

        rmSync(path.join(cli, 'from-a-terminal.txt'), { force: true });
        await vscode.commands.executeCommand('gitHawk.selectRepository', web);
    });
});
