import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCliWorkingTreeReader } from './GitCliWorkingTreeReader';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliWorkingTreeReader', () => {
    let repo: TemporaryRepository | undefined;

    const write = (name: string, content: string) => {
        writeFileSync(join(repo!.path, name), content);
    };

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    it('reports a clean tree as clean', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');

        expect(await new GitCliWorkingTreeReader(repo.path).read()).toEqual({
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
        });
    });

    it('counts what git itself reports', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');

        write('tracked.txt', 'original\n');
        repo.git(['add', 'tracked.txt']);
        repo.git(['commit', '-m', 'add tracked']);

        write('tracked.txt', 'changed\n');
        write('staged.txt', 'new file\n');
        repo.git(['add', 'staged.txt']);
        write('untracked.txt', 'nobody knows about me\n');

        expect(await new GitCliWorkingTreeReader(repo.path).read()).toEqual({
            staged: 1,
            unstaged: 1,
            untracked: 1,
            conflicted: 0,
        });
    });

    /**
     * The real reason -z is used. A newline in a path makes git quote it in the
     * default output, which the parser would then read as two records.
     */
    it('counts a file whose name contains a newline once', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        write('odd\nname.txt', 'hello\n');

        const status = await new GitCliWorkingTreeReader(repo.path).read();

        expect(status.untracked).toBe(1);
    });

    it('counts a rename once', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        write('before.txt', 'contents that stay the same\n');
        repo.git(['add', 'before.txt']);
        repo.git(['commit', '-m', 'add before']);

        repo.git(['mv', 'before.txt', 'after.txt']);

        const status = await new GitCliWorkingTreeReader(repo.path).read();

        expect(status.staged).toBe(1);
        expect(status.unstaged).toBe(0);
        expect(status.untracked).toBe(0);
    });

    it('counts an unresolved conflict as conflicted', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        write('shared.txt', 'base\n');
        repo.git(['add', 'shared.txt']);
        repo.git(['commit', '-m', 'base']);

        repo.git(['checkout', '-b', 'theirs']);
        write('shared.txt', 'their version\n');
        repo.git(['commit', '-am', 'their change']);

        repo.git(['checkout', 'main']);
        write('shared.txt', 'our version\n');
        repo.git(['commit', '-am', 'our change']);

        // Expected to fail; the conflict is the point.
        try {
            repo.git(['merge', 'theirs']);
        } catch {
            // git exits non-zero on a conflicting merge.
        }

        const status = await new GitCliWorkingTreeReader(repo.path).read();
        expect(status.conflicted).toBe(1);
    });

    it('counts untracked files inside an untracked directory', async () => {
        // git collapses these to the directory by default. Whether that is one
        // change or three, the row must not claim the tree is clean.
        repo = TemporaryRepository.create();
        repo.commit('first');
        mkdirSync(join(repo.path, 'brand-new'));
        write(join('brand-new', 'a.txt'), 'a\n');
        write(join('brand-new', 'b.txt'), 'b\n');

        const status = await new GitCliWorkingTreeReader(repo.path).read();

        expect(status.untracked).toBeGreaterThan(0);
    });
});
