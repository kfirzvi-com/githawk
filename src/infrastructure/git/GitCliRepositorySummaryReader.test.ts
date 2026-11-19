import { afterEach, describe, expect, it } from 'vitest';
import { renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitCliRepositorySummaryReader } from './GitCliRepositorySummaryReader';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliRepositorySummaryReader', () => {
    let repo: TemporaryRepository | undefined;

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    const read = () => new GitCliRepositorySummaryReader(repo!.path).read();

    it('reads a clean repository as its branch and nothing else', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('first');

        expect(await read()).toEqual({
            head: 'main',
            detached: false,
            unborn: false,
            upstream: undefined,
            ahead: 0,
            behind: 0,
            status: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
            changedFiles: 0,
        });
    });

    it('counts a file staged and edited again once, though it is both', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('first');
        writeFileSync(join(repo.path, 'half.txt'), 'one\n');
        repo.git(['add', 'half.txt']);
        writeFileSync(join(repo.path, 'half.txt'), 'two\n');
        writeFileSync(join(repo.path, 'new.txt'), 'new\n');

        const summary = await read();

        expect(summary.changedFiles).toBe(2);
        expect(summary.status).toEqual({
            staged: 1,
            unstaged: 1,
            untracked: 1,
            conflicted: 0,
        });
    });

    it('does not read a rename’s old path as another file', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('first');
        const [file] = repo.git(['ls-files']).split('\n');
        renameSync(join(repo.path, file), join(repo.path, 'renamed.txt'));
        repo.git(['add', '-A']);
        writeFileSync(join(repo.path, 'other.txt'), 'other\n');

        const summary = await read();

        expect(summary.changedFiles).toBe(2);
        expect(summary.status.staged).toBe(1);
        expect(summary.status.untracked).toBe(1);
    });

    it('counts how far the branch is ahead of and behind its upstream', async () => {
        repo = TemporaryRepository.createWithRemote('main');
        repo.commit('first');
        repo.publish('main');
        repo.advanceRemote('main', 'theirs');
        repo.git(['fetch', '--quiet']);
        repo.commit('mine one');
        repo.commit('mine two');

        const summary = await read();

        expect(summary.upstream).toBe('origin/main');
        expect(summary.ahead).toBe(2);
        expect(summary.behind).toBe(1);
    });

    it('names a detached HEAD by its short hash', async () => {
        repo = TemporaryRepository.create('main');
        const hash = repo.commit('first');
        repo.checkout(hash);

        const summary = await read();

        expect(summary.detached).toBe(true);
        expect(summary.head).toBe(hash.slice(0, 7));
    });

    it('names the unborn branch of a repository with no commit yet', async () => {
        repo = TemporaryRepository.create('trunk');
        writeFileSync(join(repo.path, 'first.txt'), 'first\n');

        const summary = await read();

        expect(summary).toMatchObject({ head: 'trunk', unborn: true, changedFiles: 1 });
    });

    it('counts a conflict as conflicted, not as staged and modified', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('base');
        writeFileSync(join(repo.path, 'shared.txt'), 'base\n');
        repo.git(['add', 'shared.txt']);
        repo.git(['commit', '--quiet', '-m', 'shared']);
        repo.branch('other');
        repo.checkout('main');
        writeFileSync(join(repo.path, 'shared.txt'), 'main side\n');
        repo.git(['commit', '--quiet', '-am', 'main side']);
        repo.checkout('other');
        writeFileSync(join(repo.path, 'shared.txt'), 'other side\n');
        repo.git(['commit', '--quiet', '-am', 'other side']);
        try {
            repo.git(['merge', '--quiet', 'main']);
        } catch {
            // The conflict is the point.
        }

        const summary = await read();

        expect(summary.status.conflicted).toBe(1);
        expect(summary.status.staged).toBe(0);
        expect(summary.changedFiles).toBe(1);
    });

    it('leaves the index alone, so reading the status is not itself a change', async () => {
        repo = TemporaryRepository.create('main');
        repo.commit('first');
        const index = join(repo.path, repo.git(['rev-parse', '--git-path', 'index']).trim());
        const before = statSync(index).mtimeMs;
        // A tracked file with a new mtime: a plain `git status` would
        // refresh its stat cache and rewrite the index.
        const [file] = repo.git(['ls-files']).split('\n');
        const later = new Date(Date.now() + 5_000);
        utimesSync(join(repo.path, file), later, later);

        await read();

        expect(statSync(index).mtimeMs).toBe(before);
    });
});
