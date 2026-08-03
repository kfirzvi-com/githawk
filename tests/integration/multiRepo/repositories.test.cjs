const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const vscode = require('vscode');

const { EXTENSION_ID } = require('../extensionId.cjs');
const SECTION = 'gitHawk';
const DEPTH_SETTING = 'repositoryScanDepth';

const workspace = () => vscode.workspace.workspaceFolders[0].uri.fsPath;

const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Waits for a condition, since a rescan is asynchronous. */
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

/** Discovered roots as workspace-relative paths, sorted, for readable failures. */
async function foundPaths() {
    const { repositories } = await discovered();
    return repositories
        .map((repository) => path.relative(workspace(), repository.root))
        .sort();
}

/**
 * Changes the depth and waits until the extension has acted on it. The setting
 * is written to the workspace, so it lands in the throwaway sample folder.
 */
async function setDepth(depth) {
    await vscode.workspace
        .getConfiguration(SECTION)
        .update(DEPTH_SETTING, depth, vscode.ConfigurationTarget.Workspace);

    return eventually(`the scan to run at depth ${depth}`, async () => {
        const paths = await foundPaths();
        // Every depth in these tests changes what is found, so the count
        // settling is a reliable signal that the rescan has happened.
        return paths.length === expectedCountAtDepth(depth) ? paths : undefined;
    });
}

function expectedCountAtDepth(depth) {
    switch (depth) {
        case 0:
            return 0; // the workspace root is not a repository
        case 1:
            return 1; // web
        case 2:
            return 4; // web, apps/api, tools/cli, tools/cli-wt
        case 3:
            return 5; // + apps/api/tools, nested inside a repository
        default:
            return 6; // + deep/a/b/service
    }
}

suite('GitHawk across several repositories', () => {
    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} not found`);
        await extension.activate();
        await setDepth(2);
    });

    suiteTeardown(async () => {
        await vscode.workspace
            .getConfiguration(SECTION)
            .update(DEPTH_SETTING, undefined, vscode.ConfigurationTarget.Workspace);
    });

    test('finds every repository within the configured depth', async () => {
        assert.deepEqual(await foundPaths(), [
            'apps/api',
            'tools/cli',
            'tools/cli-wt',
            'web',
        ]);
    });

    test('a linked worktree counts as a repository', async () => {
        // Its .git is a file holding a `gitdir:` pointer, not a directory.
        assert.ok((await foundPaths()).includes('tools/cli-wt'));
    });

    test('ignores repositories in node_modules and in dot-directories', async () => {
        const paths = await foundPaths();

        assert.ok(!paths.some((found) => found.startsWith('node_modules')));
        assert.ok(!paths.some((found) => found.startsWith('.cache')));
    });

    test('labels each repository by name and location', async () => {
        const { repositories } = await discovered();
        const api = repositories.find((r) => r.root.endsWith('/apps/api'));

        assert.equal(api.name, 'api');
        assert.equal(api.description, 'apps/api');
    });

    test('opens one of them by default', async () => {
        const { activeRoot } = await discovered();

        // Sorted by path, so the first is a defensible and stable default.
        assert.equal(activeRoot, path.join(workspace(), 'apps/api'));
    });

    test('reads the active repository, not the first workspace folder', async () => {
        const root = path.join(workspace(), 'apps/api');
        const head = git(['rev-parse', 'HEAD'], root);

        await vscode.commands.executeCommand('gitHawk.compareCommits', [head]);

        const summary = await eventually('a comparison in apps/api', async () => {
            const current = await vscode.commands.executeCommand(
                'gitHawk.lastComparison'
            );
            return current && current.files.length > 0 ? current : undefined;
        });

        // The marker file names the repository, so this cannot pass by accident.
        assert.deepEqual(summary.files, ['api-only.txt']);
    });

    test('switching repository moves every git operation with it', async () => {
        const root = path.join(workspace(), 'web');

        await vscode.commands.executeCommand('gitHawk.selectRepository', root);

        const { activeRoot } = await discovered();
        assert.equal(activeRoot, root);

        const head = git(['rev-parse', 'HEAD'], root);
        await vscode.commands.executeCommand('gitHawk.compareCommits', [head]);

        const summary = await eventually('a comparison in web', async () => {
            const current = await vscode.commands.executeCommand(
                'gitHawk.lastComparison'
            );
            return current && current.files.includes('web-only.txt')
                ? current
                : undefined;
        });

        assert.deepEqual(summary.files, ['web-only.txt']);
    });

    test('switching clears the changes left over from the other repository', async () => {
        // Those files, and the revisions behind them, do not exist here.
        await vscode.commands.executeCommand(
            'gitHawk.selectRepository',
            path.join(workspace(), 'tools/cli')
        );

        const current = await eventually(
            'the Changes view to be emptied',
            async () =>
                (await vscode.commands.executeCommand('gitHawk.lastComparison'))
                    ? undefined
                    : 'cleared'
        );

        assert.equal(current, 'cleared');
    });

    test('the picker offers a rescan, with a shortcut to the depth setting', async () => {
        const { labels, withSettingsButton } = await vscode.commands.executeCommand(
            'gitHawk.repositoryPickItems'
        );

        const rescan = labels.find((label) => label.includes('Search again'));
        assert.ok(rescan, `no rescan entry in ${JSON.stringify(labels)}`);
        // The gear is what turns "my repository is not listed" into something
        // fixable without leaving the picker.
        assert.deepEqual(withSettingsButton, [rescan]);
    });

    test('the picker marks which repository is open', async () => {
        const { activeRoot } = await discovered();
        const active = path.basename(activeRoot);
        const { labels } = await vscode.commands.executeCommand(
            'gitHawk.repositoryPickItems'
        );

        const checked = labels.filter((label) => label.includes('$(check)'));
        assert.deepEqual(checked, [`$(check) ${active}`]);
    });

    test('an unknown repository is ignored rather than switched to', async () => {
        const before = (await discovered()).activeRoot;

        await vscode.commands.executeCommand(
            'gitHawk.selectRepository',
            '/tmp/not-a-discovered-repository'
        );

        assert.equal((await discovered()).activeRoot, before);
    });

    test('depth 0 searches only the opened folder', async () => {
        assert.deepEqual(await setDepth(0), []);
    });

    test('depth 1 reaches the immediate children', async () => {
        assert.deepEqual(await setDepth(1), ['web']);
    });

    test('depth 3 finds a repository nested inside another one', async () => {
        // Descent continues through a repository, which is what makes
        // submodules and monorepo sub-repositories discoverable.
        assert.ok((await setDepth(3)).includes('apps/api/tools'));
    });

    test('depth 4 reaches the deepest one', async () => {
        assert.ok((await setDepth(4)).includes('deep/a/b/service'));
    });

    test('the active repository survives a rescan', async () => {
        await vscode.commands.executeCommand(
            'gitHawk.selectRepository',
            path.join(workspace(), 'tools/cli')
        );

        await setDepth(2);

        assert.equal(
            (await discovered()).activeRoot,
            path.join(workspace(), 'tools/cli')
        );
    });
});

/**
 * Blame has to answer for the file on screen, not for whichever repository the
 * graph happens to be pointed at.
 *
 * This is the one tier that can catch it: with a single repository the two are
 * always the same, and the difference only appears in a workspace holding
 * several — which is the layout this session exists for.
 */
suite('blame across several repositories', () => {
    const blame = (file) => vscode.commands.executeCommand('gitHawk.blame', file);

    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
        await eventually(
            'the scan to find more than one repository',
            async () => (await foundPaths()).length > 1
        );
    });

    /** Each repository in the sample holds one file, named after itself. */
    const aTrackedFileIn = (root) =>
        path.join(root, git(['ls-files'], root).split('\n')[0].trim());

    test('blames a file in the repository GitHawk is pointed at', async () => {
        const { activeRoot } = await discovered();
        const blocks = await blame(aTrackedFileIn(activeRoot));

        assert.ok(Array.isArray(blocks) && blocks.length > 0);
    });

    test('blames a file in a repository that is not the active one', async () => {
        const { repositories, activeRoot } = await discovered();
        const other = repositories.find(
            (repository) => repository.root !== activeRoot
        );
        assert.ok(other, 'the sample should hold more than one repository');

        const blocks = await blame(aTrackedFileIn(other.root));

        assert.ok(
            Array.isArray(blocks) && blocks.length > 0,
            `no blame for a file in ${other.root} while ${activeRoot} was active`
        );
    });
});
