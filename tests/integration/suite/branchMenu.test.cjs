const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();

const menu = (name, isRemote = false) =>
    vscode.commands.executeCommand('gitHawk.branchMenuEntries', name, isRemote);

suite('branch menu grouping', () => {
    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
    });

    test('groups a local branch by topic, in a sensible order', async () => {
        // main is one behind its upstream in the sample repository, so every
        // group this menu can produce is present.
        const { separators } = await menu('main');

        // Sync first: "does this branch need anything?" is the usual reason to
        // open the menu at all.
        assert.deepEqual(separators, [
            'Sync',
            'Compare',
            'Check out',
            'Worktree',
            'Bring into current branch',
            'Manage',
        ]);
    });

    test('offers pull and push for a local branch, always', async () => {
        // Not only when there is something to do: "where is push?" should have
        // the same answer every time the menu opens.
        const { entries } = await menu('main');
        const labels = entries.map((e) => e.label).join('\n');

        assert.match(labels, /Pull main from origin\/main/);
        assert.match(labels, /Push main to origin/);
    });

    test('puts the pull entry first when a branch is behind, and says so', async () => {
        // A colleague pushes to main while we sit on feature/reporting.
        const scratch = `${root()}-collab`;
        execFileSync('git', ['clone', '--quiet', `${root()}-remote`, scratch]);
        execFileSync('git', ['config', 'user.email', 'c@example.com'], { cwd: scratch });
        execFileSync('git', ['config', 'user.name', 'Colleague'], { cwd: scratch });
        execFileSync('git', ['commit', '--quiet', '--allow-empty', '-m', 'their work'], { cwd: scratch });
        execFileSync('git', ['push', '--quiet', 'origin', 'main'], { cwd: scratch });
        execFileSync('rm', ['-rf', scratch]);
        git(['fetch', '--quiet', 'origin']);

        const { separators, entries } = await menu('main');

        assert.equal(separators[0], 'Sync');
        assert.match(entries[0].label, /Pull main from origin\/main/);
        // The count lives in the description, where QuickPick shows it dimmed.
        assert.match(entries[0].description ?? '', /behind/);
        // main is not checked out here, so it is a ref write rather than a pull.
        assert.match(entries[0].description ?? '', /no checkout/);
    });

    test('offers to publish a branch that tracks nothing', async () => {
        git(['branch', 'never-pushed']);
        try {
            const { entries } = await menu('never-pushed');
            const publish = entries.find((e) => /Publish/.test(e.label));

            assert.ok(
                publish,
                `no publish entry: ${JSON.stringify(entries.map((e) => e.label))}`
            );
            assert.match(publish.description ?? '', /only here/);
            // Nothing to pull from, so pull is absent rather than broken.
            assert.ok(!entries.some((e) => /^\$\(cloud-download\) Pull/.test(e.label)));
        } finally {
            git(['branch', '-D', 'never-pushed']);
        }
    });

    test('offers neither push nor pull for a remote-tracking branch', async () => {
        // origin/main is a local mirror of someone else's branch; pushing it is
        // not a thing git can be asked to do.
        const { separators } = await menu('origin/main', true);

        assert.ok(!separators.includes('Sync'));
    });

    test('offers remote-only actions for a remote branch', async () => {
        const { separators, labels } = await menu('origin/main', true);
        const shown = `separators=${JSON.stringify(separators)} labels=${JSON.stringify(labels)}`;

        assert.ok(separators.includes('Check out'), shown);
        assert.ok(separators.includes('Manage'), shown);
        assert.ok(
            labels.some((l) => /Delete origin\/main on the remote/.test(l)),
            shown
        );
        // Renaming applies to local branches only; a remote rename is a push.
        assert.ok(!labels.some((l) => /Rename/.test(l)), shown);
    });

    test('never offers to check out or merge the branch already checked out', async () => {
        const current = git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const { separators, labels } = await menu(current);

        assert.ok(!separators.includes('Check out'));
        assert.ok(!separators.includes('Bring into current branch'));
        // Renaming the current branch is fine, deleting it is not.
        assert.ok(labels.some((l) => /Rename/.test(l)));
        assert.ok(!labels.some((l) => new RegExp(`Delete ${current}$`).test(l)));
    });

    test('every group heading has at least one entry under it', async () => {
        for (const name of ['main', 'spike/graphql', 'origin/main']) {
            const isRemote = name.startsWith('origin/');
            const { separators, labels } = await menu(name, isRemote);

            assert.ok(labels.length > 0, `${name} produced no entries`);
            // A heading with nothing beneath it would be a bug in the grouping.
            assert.ok(
                separators.length <= labels.length,
                `${name} has more headings than entries`
            );
        }
    });
});
