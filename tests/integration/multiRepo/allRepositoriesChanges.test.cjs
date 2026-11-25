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
    throw new Error(`timed out waiting for ${describe} (last: ${last})`);
}

const discovered = () => vscode.commands.executeCommand('gitHawk.repositories');
const tree = () => vscode.commands.executeCommand('gitHawk.changesTree');

/**
 * The headings for the two repositories this suite changes. Others may have
 * one too — apps/api holds a nested repository, which git reports as an
 * untracked directory of its parent — and are not this suite's business.
 */
const headingsOf = (nodes, roots) => nodes.filter((node) => roots.includes(node.root));

/** The file rows beneath a node, as the view built them. */
function filesBeneath(node) {
    if (node.kind === 'file') {
        return [node];
    }
    return (node.children ?? []).flatMap(filesBeneath);
}

/**
 * The toggle in the Changes view's title bar: every repository's working
 * tree at once, each under its own heading — and nothing a row does moves the
 * graph off the repository the selector chose.
 */
suite('the Changes view across every repository', () => {
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
        writeFileSync(path.join(web, 'web-only.txt'), 'web-only\nchanged in web\n');
        writeFileSync(path.join(cli, 'cli-only.txt'), 'cli-only\nchanged in cli\n');
        writeFileSync(path.join(cli, 'cli-new.txt'), 'new in cli\n');
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('gitHawk.showSelectedRepository');
        for (const root of [web, cli]) {
            git(['reset', '-q'], root);
            git(['checkout', '-q', '--', '.'], root);
        }
        rmSync(path.join(cli, 'cli-new.txt'), { force: true });
        if (previouslyActive) {
            await vscode.commands.executeCommand('gitHawk.selectRepository', previouslyActive);
        }
        await vscode.commands.executeCommand('gitHawk.clearChanges');
    });

    test('shows a heading per repository with changes, the selected one first', async () => {
        await vscode.commands.executeCommand('gitHawk.showAllRepositories');
        await vscode.commands.executeCommand('gitHawk.showUncommittedChanges');

        const roots = await eventually('a heading for each changed repository', async () => {
            const nodes = await tree();
            return nodes.every((node) => node.kind === 'repository') &&
                headingsOf(nodes, [web, cli]).length === 2
                ? headingsOf(nodes, [web, cli])
                : undefined;
        });
        assert.equal((await tree())[0].root, web, 'the selected repository is not first');

        assert.deepEqual(
            roots.map((node) => [node.root, node.active, node.branch]),
            [
                [web, true, 'main'],
                [cli, false, 'main'],
            ]
        );
        assert.deepEqual(filesBeneath(roots[0]).map((row) => row.change.path), ['web-only.txt']);
        assert.deepEqual(
            filesBeneath(roots[1]).map((row) => row.change.path).sort(),
            ['cli-new.txt', 'cli-only.txt']
        );
        // Every row knows its repository, which is what its actions run in.
        assert.ok(filesBeneath(roots[1]).every((row) => row.root === cli));
    });

    test('staging a row of another repository stages it there, and the graph stays put', async () => {
        const cliHeading = (await tree()).find((node) => node.root === cli);
        const row = filesBeneath(cliHeading).find((r) => r.change.path === 'cli-only.txt');
        assert.ok(row, 'the cli change is not offered');

        await vscode.commands.executeCommand('gitHawk.stage', row);

        assert.equal(git(['diff', '--cached', '--name-only'], cli), 'cli-only.txt');
        assert.equal(git(['diff', '--cached', '--name-only'], web), '');
        assert.equal((await discovered()).activeRoot, web);

        await eventually('the tree to show it as staged in cli', async () => {
            const heading = (await tree()).find((node) => node.root === cli);
            return heading?.children.some(
                (group) =>
                    group.group === 'staged' &&
                    filesBeneath(group).some((r) => r.change.path === 'cli-only.txt')
            );
        });
    });

    test('opening a row of another repository leaves the graph where it was', async () => {
        const cliHeading = (await tree()).find((node) => node.root === cli);
        const row = filesBeneath(cliHeading).find((r) => r.change.path === 'cli-new.txt');

        await vscode.commands.executeCommand('gitHawk.openChangedFile', row);

        const opened = await eventually('the diff to open on the cli file', async () =>
            vscode.window.visibleTextEditors.find(
                (editor) => editor.document.uri.fsPath === path.join(cli, 'cli-new.txt')
            )
        );
        assert.ok(opened);
        assert.equal((await discovered()).activeRoot, web);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('switching repository with the selector moves the check, not the changes', async () => {
        await vscode.commands.executeCommand('gitHawk.selectRepository', cli);

        try {
            const roots = await eventually('cli to become the selected heading', async () => {
                const nodes = await tree();
                return nodes[0]?.root === cli && nodes[0].active ? nodes : undefined;
            });
            assert.deepEqual(
                headingsOf(roots, [web, cli]).map((node) => [node.root, node.active]),
                [
                    [cli, true],
                    [web, false],
                ]
            );
        } finally {
            await vscode.commands.executeCommand('gitHawk.selectRepository', web);
        }
        await eventually('web to be selected again', async () => (await tree())[0]?.root === web);
    });

    test('turning the toggle off shows only the selected repository', async () => {
        await vscode.commands.executeCommand('gitHawk.showSelectedRepository');

        const roots = await eventually('the headings to go', async () => {
            const nodes = await tree();
            return nodes.length > 0 && nodes.every((node) => node.kind === 'group')
                ? nodes
                : undefined;
        });
        assert.deepEqual(roots.flatMap(filesBeneath).map((row) => row.change.path), ['web-only.txt']);
    });
});
