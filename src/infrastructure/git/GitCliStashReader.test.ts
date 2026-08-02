import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCliStashReader } from './GitCliStashReader';
import { argsFor } from './gitActionCommands';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliStashReader', () => {
    let repo: TemporaryRepository | undefined;

    const write = (content: string) =>
        writeFileSync(join(repo!.path, 'f.txt'), `${content}\n`);

    const start = () => {
        repo = TemporaryRepository.create();
        write('committed');
        repo.git(['add', 'f.txt']);
        repo.git(['commit', '-m', 'first']);
    };

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    it('reports an empty stash as empty', async () => {
        start();
        expect(await new GitCliStashReader(repo!.path).list()).toEqual([]);
    });

    it('reads a named entry: its message, branch, and hash', async () => {
        start();
        write('put aside');
        repo!.git(
            argsFor({
                type: 'stashPush',
                message: 'half a refactor',
                includeUntracked: false,
                keepIndex: false,
            })
        );

        const [entry] = await new GitCliStashReader(repo!.path).list();

        expect(entry.message).toBe('half a refactor');
        expect(entry.isAutoNamed).toBe(false);
        expect(entry.branch).toBe('main');
        expect(entry.ref).toBe('stash@{0}');
        expect(entry.hash).toHaveLength(40);
    });

    it('marks an entry git named for us', async () => {
        // `WIP on main: 1234abc first` describes the commit the work sat on,
        // not the work, so a reader needs telling that nobody wrote it.
        start();
        write('no message');
        repo!.git(
            argsFor({
                type: 'stashPush',
                includeUntracked: false,
                keepIndex: false,
            })
        );

        const [entry] = await new GitCliStashReader(repo!.path).list();

        expect(entry.isAutoNamed).toBe(true);
        expect(entry.branch).toBe('main');
        expect(entry.message).toContain('first');
    });

    it('lists most recent first, and numbers from zero', async () => {
        start();
        for (const message of ['oldest', 'middle', 'newest']) {
            write(message);
            repo!.git(
                argsFor({
                    type: 'stashPush',
                    message,
                    includeUntracked: false,
                    keepIndex: false,
                })
            );
        }

        const entries = await new GitCliStashReader(repo!.path).list();

        expect(entries.map((e) => e.message)).toEqual([
            'newest',
            'middle',
            'oldest',
        ]);
        expect(entries.map((e) => e.ref)).toEqual([
            'stash@{0}',
            'stash@{1}',
            'stash@{2}',
        ]);
        expect(entries.map((e) => e.index)).toEqual([0, 1, 2]);
    });

    /**
     * The hazard the menu re-reads the list for. A ref is a position, so
     * dropping an entry moves every entry below it — and a ref captured before
     * the drop then names a different entry, successfully and silently.
     */
    it('renumbers the entries below one that is dropped', async () => {
        start();
        for (const message of ['oldest', 'middle', 'newest']) {
            write(message);
            repo!.git(
                argsFor({
                    type: 'stashPush',
                    message,
                    includeUntracked: false,
                    keepIndex: false,
                })
            );
        }

        const reader = new GitCliStashReader(repo!.path);
        const before = await reader.list();
        const middle = before[1];

        repo!.git(
            argsFor({
                type: 'stashDrop',
                ref: 'stash@{0}',
                hash: before[0].hash,
            })
        );

        const after = await reader.list();
        // The same entry, at a different address.
        expect(middle.ref).toBe('stash@{1}');
        expect(after.find((e) => e.hash === middle.hash)?.ref).toBe(
            'stash@{0}'
        );
    });

    it('keeps a message containing a newline in one entry', async () => {
        // The record separator is a control character for exactly this.
        start();
        write('multi');
        repo!.git(
            argsFor({
                type: 'stashPush',
                message: 'line one\nline two',
                includeUntracked: false,
                keepIndex: false,
            })
        );

        const entries = await new GitCliStashReader(repo!.path).list();
        expect(entries).toHaveLength(1);
        expect(entries[0].message).toContain('line one');
    });

    it('takes untracked files only when asked', async () => {
        start();
        writeFileSync(join(repo!.path, 'scratch.txt'), 'never added\n');

        repo!.git(
            argsFor({
                type: 'stashPush',
                message: 'tracked only',
                includeUntracked: false,
                keepIndex: false,
            })
        );
        // Nothing tracked had changed, so git stashes nothing and the scratch
        // file is still there — which is the point of the default.
        expect(
            repo!.git(['status', '--porcelain']).includes('scratch.txt')
        ).toBe(true);

        repo!.git(
            argsFor({
                type: 'stashPush',
                message: 'with untracked',
                includeUntracked: true,
                keepIndex: false,
            })
        );
        expect(repo!.git(['status', '--porcelain'])).toBe('');
    });
});
