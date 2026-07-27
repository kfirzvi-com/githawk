import { afterEach, describe, expect, test } from 'vitest';
import { GitCliRepository, NotAGitRepositoryError } from './GitCliRepository';
import { TemporaryRepository } from './testing/temporaryRepository';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const repos: TemporaryRepository[] = [];

function newRepo(defaultBranch = 'main'): TemporaryRepository {
    const repo = TemporaryRepository.create(defaultBranch);
    repos.push(repo);
    return repo;
}

afterEach(() => {
    while (repos.length) {
        repos.pop()!.dispose();
    }
});

describe('GitCliRepository', () => {
    test('reads a linear history newest first', async () => {
        const repo = newRepo();
        repo.commit('first');
        repo.commit('second');
        repo.commit('third');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.commits).toHaveLength(3);
        expect(result.commits.map((c) => c.message)).toEqual([
            'third',
            'second',
            'first',
        ]);
        expect(result.hasMoreHistory).toBe(false);
        expect(result.isEmpty).toBe(false);
    });

    test('captures author, date, and parent topology', async () => {
        const repo = newRepo();
        repo.commit('first');
        const second = repo.commit('second');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();
        const commit = result.getCommit(second)!;

        expect(commit).toBeDefined();
        expect(commit.author).toBe('Test Author');
        expect(commit.timestamp.getTime()).toBeGreaterThan(0);
        expect(commit.parentHashes).toHaveLength(1);
        expect(commit.isMergeCommit).toBe(false);
    });

    test('reads a merge commit with both parents', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        repo.commit('feature work');
        repo.checkout('main');
        repo.commit('mainline work');
        const mergeHash = repo.merge('feature', 'Merge feature');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();
        const merge = result.getCommit(mergeHash)!;

        expect(merge.isMergeCommit).toBe(true);
        expect(merge.parentHashes).toHaveLength(2);
        expect(result.getLoadedParents(merge)).toHaveLength(2);
    });

    test('includes commits reachable only from other branches', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('side');
        repo.commit('only on side');
        repo.checkout('main');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        // --all is what makes this a graph rather than a list of HEAD's history.
        expect(result.commits.map((c) => c.message)).toContain('only on side');
    });

    test('reads local and remote branches, marking the current one', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        repo.commit('feature work');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        const names = result.localBranches.map((b) => b.name).sort();
        expect(names).toEqual(['feature', 'main']);
        expect(result.currentBranch?.name).toBe('feature');
        expect(result.remoteBranches).toEqual([]);
    });

    test('exposes branch and tag names as refs on their commit', async () => {
        const repo = newRepo();
        const base = repo.commit('base');
        repo.tag('v1.0.0');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();
        const commit = result.getCommit(base)!;

        expect(commit.refs).toContain('main');
        expect(commit.refs).toContain('v1.0.0');
        // The `HEAD -> ` prefix must be unwrapped, not kept verbatim.
        expect(commit.refs.some((r) => r.includes('->'))).toBe(false);
    });

    test('works on a repository whose default branch is master', async () => {
        const repo = newRepo('master');
        repo.commit('base');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.currentBranch?.name).toBe('master');
        expect(result.getCommit(repo.head())!.refs).toContain('master');
    });

    test('accepts a commit with an empty message', async () => {
        const repo = newRepo();
        const hash = repo.commitWithEmptyMessage();

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.getCommit(hash)!.message).toBe('');
    });

    test('handles messages containing quotes, newlines, and separators', async () => {
        const repo = newRepo();
        repo.commit('fix: handle "quoted" and \'single\' text');
        const tricky = repo.commit('subject with | pipes, commas, and -> arrows');

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.commits).toHaveLength(2);
        expect(result.getCommit(tricky)!.message).toBe(
            'subject with | pipes, commas, and -> arrows'
        );
    });

    test('returns an empty repository when there are no commits', async () => {
        const repo = newRepo();

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.isEmpty).toBe(true);
        expect(result.commits).toEqual([]);
        expect(result.branches).toEqual([]);
    });

    test('reports truncation and honours the limit', async () => {
        const repo = newRepo();
        for (let i = 0; i < 6; i++) {
            repo.commit(`commit ${i}`);
        }

        const result = await new GitCliRepository({
            cwd: repo.path,
            limit: 3,
        }).getRepository();

        expect(result.commits).toHaveLength(3);
        expect(result.hasMoreHistory).toBe(true);
        // The oldest loaded commit references a parent outside the window, which
        // must be reported rather than thrown on.
        expect(result.boundaryParentHashes).toHaveLength(1);
    });

    test('does not report truncation when the history fits exactly', async () => {
        const repo = newRepo();
        repo.commit('one');
        repo.commit('two');
        repo.commit('three');

        const result = await new GitCliRepository({
            cwd: repo.path,
            limit: 3,
        }).getRepository();

        expect(result.commits).toHaveLength(3);
        expect(result.hasMoreHistory).toBe(false);
    });

    test('resolves the repository root from a subdirectory', async () => {
        const repo = newRepo();
        repo.commit('base');
        const sub = join(repo.path, 'nested', 'deeper');
        mkdirSync(sub, { recursive: true });

        const root = await new GitCliRepository({ cwd: sub }).repositoryRoot();

        // macOS resolves /var to /private/var, so compare the final segment.
        expect(basename(root)).toBe(basename(repo.path));
    });

    test('throws NotAGitRepositoryError outside a working tree', async () => {
        const notARepo = mkdtempSync(join(tmpdir(), 'githawk-plain-'));

        try {
            await expect(
                new GitCliRepository({ cwd: notARepo }).getRepository()
            ).rejects.toThrow(NotAGitRepositoryError);
        } finally {
            rmSync(notARepo, { recursive: true, force: true });
        }
    });

    test('survives a detached HEAD', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');
        repo.git(['checkout', '--detach', first]);

        const result = await new GitCliRepository({ cwd: repo.path }).getRepository();

        expect(result.commits).toHaveLength(2);
        // No branch is checked out, so no branch is current.
        expect(result.currentBranch).toBeUndefined();
    });
});
