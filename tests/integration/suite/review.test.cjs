/**
 * Review mode against the real extension host and real git: the tree's own
 * rows, the comment controller's own save, the handoff's own terminal.
 *
 * Works on the shared sample repository's uncommitted changes and leaves
 * them as it found them — and ends its review, so no other suite starts in
 * the middle of one.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const vscode = require('vscode');
const { EXTENSION_ID } = require('../extensionId.cjs');

const root = () => vscode.workspace.workspaceFolders[0].uri.fsPath;
const git = (args) =>
    execFileSync('git', args, { cwd: root(), encoding: 'utf8' }).trim();
const run = (command, ...args) => vscode.commands.executeCommand(command, ...args);
const state = () => run('gitHawk.review.state');

const SCHEDULE = 'src/features/reporting/schedule.ts';

/** Polls until the check passes, for what the extension does on its own schedule. */
async function eventually(check, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            return await check();
        } catch (error) {
            last = error;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }
    throw last;
}

suite('code review', () => {
    let original;

    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID).activate();
        original = readFileSync(join(root(), SCHEDULE), 'utf8');
    });

    suiteTeardown(async () => {
        writeFileSync(join(root(), SCHEDULE), original);
        await run('gitHawk.review.end', true);
        await vscode.workspace
            .getConfiguration('gitHawk')
            .update('aiTools', undefined, vscode.ConfigurationTarget.Global);
    });

    test('starts on the uncommitted changes, with every file read into hunks', async () => {
        await run('gitHawk.showUncommittedChanges');
        await run('gitHawk.review.start');
        const review = await state();

        assert.equal(review.active, true, 'the Changes view is not showing the review');
        assert.deepEqual(review.review.spec, { kind: 'workingTree' });
        const schedule = review.files.find((file) => file.path === SCHEDULE);
        assert.ok(schedule, `the unstaged file is missing: ${JSON.stringify(review.files)}`);
        assert.ok(schedule.hunks.length >= 1, 'the unstaged change has no hunks');
        assert.equal(schedule.state, 'unviewed');
    });

    test('a file is viewed exactly when every hunk in it is', async () => {
        const before = (await state()).files.find((file) => file.path === SCHEDULE);
        for (let index = 0; index < before.hunks.length; index++) {
            await run('gitHawk.review.markPath', SCHEDULE, true, index);
        }

        const after = (await state()).files.find((file) => file.path === SCHEDULE);
        assert.equal(after.state, 'viewed');
        assert.ok(after.hunks.every((hunk) => hunk.viewed));
    });

    /**
     * The point of the content ids, and of the watcher: an agent acting on
     * the review writes the file from outside the editor, and what it
     * rewrote must stop counting as read.
     */
    test('a hunk rewritten on disk outside the editor comes back unviewed', async () => {
        const path = join(root(), SCHEDULE);
        const changed = readFileSync(path, 'utf8')
            .split('\n')
            .map((line, index, lines) =>
                index === lines.length - 2 ? `${line} // rewritten by an agent` : line
            )
            .join('\n');
        writeFileSync(path, changed);

        await eventually(async () => {
            const schedule = (await state()).files.find((file) => file.path === SCHEDULE);
            assert.notEqual(schedule.state, 'viewed', 'the rewrite still reads as viewed');
        });
    });

    test('a comment keeps the lines it was written on, through the thread widget\'s save', async () => {
        const schedule = (await state()).files.find((file) => file.path === SCHEDULE);
        const line = Math.max(schedule.hunks[0].newStart, 1);
        const uri = vscode.Uri.file(join(root(), SCHEDULE));
        const document = await vscode.workspace.openTextDocument(uri);

        await run('gitHawk.review.commentForTesting', uri.toString(), line, line, 'Name this constant');

        const [comment] = (await state()).review.comments;
        assert.ok(comment, 'the comment was not kept');
        assert.equal(comment.path, SCHEDULE);
        assert.equal(comment.side, 'new');
        assert.equal(comment.excerpt, document.lineAt(line - 1).text);
        assert.equal(comment.sentAt, undefined);
    });

    test('sending types one line into a new session, pointing at the whole review', async () => {
        const received = join(tmpdir(), `githawk-review-handoff-${Date.now()}.txt`);
        await vscode.workspace.getConfiguration('gitHawk').update(
            'aiTools',
            [
                {
                    name: 'Recorder',
                    command: 'true',
                    promptCommand: `node -e "require('fs').writeFileSync(process.argv[1], process.argv[2])" ${received} {prompt}`,
                },
            ],
            vscode.ConfigurationTarget.Global
        );

        try {
            const result = await run('gitHawk.review.sendToAi', { tool: 'Recorder' });

            assert.ok(result, 'nothing was sent');
            assert.equal(result.sent, 1);
            assert.ok(existsSync(result.documentPath), 'the review document was not written');
            assert.match(readFileSync(result.documentPath, 'utf8'), /Name this constant/);
            assert.ok(
                result.documentPath.startsWith(join(realpathSync.native(root()), '.git')),
                'the review document is in the working tree, where it would be committed'
            );
            await eventually(() =>
                assert.equal(readFileSync(received, 'utf8'), result.prompt)
            );
            const [comment] = (await state()).review.comments;
            assert.ok(comment.sentAt, 'the comment was not marked sent');
        } finally {
            rmSync(received, { force: true });
        }
    });

    test('leaving it for a commit keeps it, and resuming brings it back as it was', async () => {
        const { review } = await state();

        await run('gitHawk.compareCommits', [git(['rev-parse', 'HEAD'])]);
        const away = await state();
        assert.equal(away.active, false, 'a commit was shown as though it were the review');
        assert.ok(
            away.reviews.some((entry) => entry.id === review.id),
            'showing a commit discarded the review'
        );

        await run('gitHawk.review.resume', review.id);
        const back = await state();
        assert.equal(back.active, true);
        assert.equal(back.review.id, review.id);
        assert.deepEqual(back.review.viewed, review.viewed);
        assert.equal(back.review.comments.length, 1);
    });

    /**
     * A pull request's commits and your own work in progress are two
     * reviews, both kept: starting the second must not end the first.
     */
    test('reviewing a commit as well keeps both, each with its own marks', async () => {
        const first = (await state()).review;

        await run('gitHawk.compareCommits', [git(['rev-parse', 'HEAD'])]);
        await run('gitHawk.review.start');
        const second = await state();

        assert.equal(second.active, true);
        assert.notEqual(second.review.id, first.id);
        assert.equal(second.review.spec.kind, 'singleCommit');
        assert.deepEqual(second.review.viewed, {});
        assert.deepEqual(
            second.reviews.map((entry) => entry.id).sort(),
            [first.id, second.review.id].sort()
        );
        assert.ok(second.files.every((file) => file.hunks.length > 0 || file.state === 'unviewed'));

        // Ended from its row, which passes the row; the first is untouched.
        await run('gitHawk.review.end', { review: { id: second.review.id } });
        await run('gitHawk.review.resume', first.id);
        const after = await state();
        assert.equal(after.review.id, first.id);
        assert.equal(after.reviews.length, 1);
    });

    test('ending it forgets it', async () => {
        assert.equal(await run('gitHawk.review.end', true), true);
        const after = await state();
        assert.equal(after.review, undefined);
        assert.equal(after.active, false);
        assert.deepEqual(after.reviews, []);
    });
});
