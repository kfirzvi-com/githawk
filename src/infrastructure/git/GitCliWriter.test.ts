import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GitActionFailedError, GitCliWriter } from './GitCliWriter';
import { GitCliRepository } from './GitCliRepository';
import { TemporaryRepository } from './testing/temporaryRepository';
import { PerformGitActionUseCase } from '../../application/usecases/PerformGitActionUseCase';

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

const read = (repo: TemporaryRepository) =>
    new GitCliRepository({ cwd: repo.path }).getRepository();

/** Writes a tracked file with known contents and commits it. */
function commitFile(
    repo: TemporaryRepository,
    path: string,
    contents: string,
    message: string
): string {
    writeFileSync(join(repo.path, path), contents);
    repo.git(['add', path]);
    repo.git(['commit', '-m', message]);
    return repo.head();
}

describe('GitCliWriter against real repositories', () => {
    test('checks out an existing branch', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        repo.commit('feature work');
        repo.checkout('main');

        await new GitCliWriter(repo.path).perform({
            type: 'checkoutBranch',
            name: 'feature',
        });

        expect((await read(repo)).currentBranch?.name).toBe('feature');
    });

    test('creates a branch at a specific commit without checking it out', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        await new GitCliWriter(repo.path).perform({
            type: 'createBranch',
            name: 'from-first',
            at: first,
            checkout: false,
        });

        const result = await read(repo);
        expect(result.getBranch('from-first')?.headCommitHash).toBe(first);
        expect(result.currentBranch?.name).toBe('main');
    });

    test('creates and checks out a branch in one step', async () => {
        const repo = newRepo();
        const first = repo.commit('first');

        await new GitCliWriter(repo.path).perform({
            type: 'createBranch',
            name: 'here',
            at: first,
            checkout: true,
        });

        expect((await read(repo)).currentBranch?.name).toBe('here');
    });

    test('detaches HEAD when checking out a commit', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        await new GitCliWriter(repo.path).perform({
            type: 'checkoutCommit',
            hash: first,
        });

        const result = await read(repo);
        expect(result.currentBranch).toBeUndefined();
        expect(repo.head()).toBe(first);
    });

    test('creates and deletes a tag', async () => {
        const repo = newRepo();
        const base = repo.commit('base');
        const writer = new GitCliWriter(repo.path);

        await writer.perform({ type: 'createTag', name: 'v1.0.0', at: base });
        expect((await read(repo)).getCommit(base)!.tagNames).toEqual(['v1.0.0']);

        await writer.perform({ type: 'deleteTag', name: 'v1.0.0' });
        expect((await read(repo)).getCommit(base)!.tagNames).toEqual([]);
    });

    test('merges a branch, creating a merge commit with --no-ff', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        repo.commit('feature work');
        repo.checkout('main');

        await new GitCliWriter(repo.path).perform({
            type: 'mergeBranch',
            name: 'feature',
            noFastForward: true,
        });

        const result = await read(repo);
        const head = result.getCommit(repo.head())!;
        expect(head.isMergeCommit).toBe(true);
    });

    test('reverts a commit by adding a new one', async () => {
        const repo = newRepo();
        repo.commit('base');
        const bad = repo.commit('bad change');

        await new GitCliWriter(repo.path).perform({ type: 'revert', hash: bad });

        const result = await read(repo);
        // A revert adds history rather than removing it.
        expect(result.commits).toHaveLength(3);
        expect(result.getCommit(bad)).toBeDefined();
    });

    test('cherry-picks a commit onto another branch', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        const wanted = repo.commit('wanted change');
        repo.checkout('main');

        await new GitCliWriter(repo.path).perform({
            type: 'cherryPick',
            hash: wanted,
        });

        const result = await read(repo);
        expect(result.getCommit(repo.head())!.message).toBe('wanted change');
        // The change is now reachable from main, and feature still has it.
        expect(result.getBranch('feature')?.headCommitHash).toBe(wanted);
        // Note: the new commit's hash can legitimately equal `wanted`. Both share
        // a parent, tree, message, author, and second, and git hashes commits
        // deterministically, so an identical commit gets an identical hash.
    });

    test('resets the branch pointer while keeping files with --soft', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        await new GitCliWriter(repo.path).perform({
            type: 'reset',
            hash: first,
            mode: 'soft',
        });

        expect(repo.head()).toBe(first);
        // The second commit's file survives, staged.
        expect(repo.git(['status', '--porcelain'])).toContain('file-1.txt');
    });

    test('discards the working tree with --hard', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        await new GitCliWriter(repo.path).perform({
            type: 'reset',
            hash: first,
            mode: 'hard',
        });

        expect(repo.head()).toBe(first);
        expect(repo.git(['status', '--porcelain']).trim()).toBe('');
    });

    test('refuses to delete an unmerged branch without force, and obeys with it', async () => {
        const repo = newRepo();
        repo.commit('base');
        repo.branch('feature');
        repo.commit('unmerged work');
        repo.checkout('main');
        const writer = new GitCliWriter(repo.path);

        await expect(
            writer.perform({ type: 'deleteBranch', name: 'feature', force: false })
        ).rejects.toThrow(GitActionFailedError);

        // The branch is still there, which is the point of -d.
        expect((await read(repo)).getBranch('feature')).toBeDefined();

        await writer.perform({ type: 'deleteBranch', name: 'feature', force: true });
        expect((await read(repo)).getBranch('feature')).toBeUndefined();
    });

    test('surfaces git’s own explanation when it refuses', async () => {
        const repo = newRepo();
        repo.commit('base');

        try {
            await new GitCliWriter(repo.path).perform({
                type: 'checkoutBranch',
                name: 'no-such-branch',
            });
            throw new Error('expected the checkout to fail');
        } catch (error) {
            expect(error).toBeInstanceOf(GitActionFailedError);
            expect((error as GitActionFailedError).gitMessage).toMatch(
                /did not match|not found|pathspec/i
            );
        }
    });

    test('treats shell metacharacters in a branch name as text', async () => {
        const repo = newRepo();
        const base = repo.commit('base');

        // A valid ref name that is also a shell payload. Git forbids spaces in
        // refs, so the metacharacters are packed without any: under a shell this
        // would create /tmp/githawk-pwned, and via execFile it is just a name.
        const hostile = 'feature/;$(touch$IFS/tmp/githawk-pwned)&&echo|x';

        await new GitCliWriter(repo.path).perform({
            type: 'createBranch',
            name: hostile,
            at: base,
            checkout: false,
        });

        expect((await read(repo)).getBranch(hostile)).toBeDefined();
        expect(existsSync('/tmp/githawk-pwned')).toBe(false);
    });
});

describe('PerformGitActionUseCase', () => {
    test('refuses a destructive action that was not confirmed', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        const useCase = new PerformGitActionUseCase(new GitCliWriter(repo.path));

        await expect(
            useCase.execute({ type: 'reset', hash: first, mode: 'hard' })
        ).rejects.toThrow(/without explicit confirmation/);

        // Nothing happened.
        expect(repo.head()).not.toBe(first);
    });

    test('runs a destructive action once confirmed', async () => {
        const repo = newRepo();
        const first = repo.commit('first');
        repo.commit('second');

        const useCase = new PerformGitActionUseCase(new GitCliWriter(repo.path));
        const outcome = await useCase.execute(
            { type: 'reset', hash: first, mode: 'hard' },
            { confirmed: true }
        );

        expect(outcome.succeeded).toBe(true);
        expect(repo.head()).toBe(first);
    });

    test('reports failure rather than throwing for non-destructive actions', async () => {
        const repo = newRepo();
        repo.commit('base');

        const outcome = await new PerformGitActionUseCase(
            new GitCliWriter(repo.path)
        ).execute({ type: 'checkoutBranch', name: 'missing' });

        expect(outcome.succeeded).toBe(false);
        expect(outcome.message).toBeTruthy();
    });
});

describe('updating a branch you are not standing on', () => {
    /** A repository where main is published and a colleague has moved it on. */
    function repoWithRemoteAhead() {
        const repo = TemporaryRepository.createWithRemote();
        repos.push(repo);
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.publish('main');

        repo.branch('feature/mine');
        commitFile(repo, 'mine.txt', 'mine\n', 'my work');

        // Someone else pushes to main while we are on the feature branch.
        repo.advanceRemote('main', 'their work');
        repo.git(['fetch', '--quiet', 'origin']);
        return repo;
    }

    test('reports main as behind once the remote moves ahead', async () => {
        const repo = repoWithRemoteAhead();

        const result = await read(repo);
        const main = result.getBranch('main')!;

        expect(main.upstream?.name).toBe('origin/main');
        expect(main.upstream?.behind).toBe(1);
        expect(main.upstream?.ahead).toBe(0);
        expect(main.canFastForwardToUpstream).toBe(true);
        expect(main.isCurrent).toBe(false);
    });

    test('fast-forwards main without checking it out', async () => {
        const repo = repoWithRemoteAhead();
        const featureHead = repo.head();

        await new GitCliWriter(repo.path).perform({
            type: 'updateBranchFromUpstream',
            branch: 'main',
            remote: 'origin',
            remoteBranch: 'main',
        });

        const result = await read(repo);
        // main advanced...
        expect(result.getBranch('main')!.upstream?.behind).toBe(0);
        // ...while we are still on the feature branch, at the same commit.
        expect(result.currentBranch?.name).toBe('feature/mine');
        expect(repo.head()).toBe(featureHead);
    });

    test('leaves the working tree and index untouched', async () => {
        const repo = repoWithRemoteAhead();

        // Uncommitted work that must survive an update of another branch.
        writeFileSync(join(repo.path, 'wip.txt'), 'precious\n');
        repo.git(['add', 'wip.txt']);
        const statusBefore = repo.git(['status', '--porcelain']);

        await new GitCliWriter(repo.path).perform({
            type: 'updateBranchFromUpstream',
            branch: 'main',
            remote: 'origin',
            remoteBranch: 'main',
        });

        expect(repo.git(['status', '--porcelain'])).toBe(statusBefore);
    });

    test('refuses to update a diverged branch rather than discarding commits', async () => {
        const repo = TemporaryRepository.createWithRemote();
        repos.push(repo);
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.publish('main');

        // Local main gains a commit...
        commitFile(repo, 'local.txt', 'local\n', 'local only');
        // ...and so does the remote, independently.
        repo.advanceRemote('main', 'their work');
        repo.git(['fetch', '--quiet', 'origin']);

        repo.branch('feature/elsewhere');

        const before = await read(repo);
        const main = before.getBranch('main')!;
        expect(main.hasDiverged).toBe(true);
        expect(main.canFastForwardToUpstream).toBe(false);

        // The absence of --force is what makes git refuse, which is the point.
        await expect(
            new GitCliWriter(repo.path).perform({
                type: 'updateBranchFromUpstream',
                branch: 'main',
                remote: 'origin',
                remoteBranch: 'main',
            })
        ).rejects.toThrow(GitActionFailedError);

        // The local commit is still there.
        expect((await read(repo)).getBranch('main')!.upstream?.ahead).toBe(1);
    });
});

describe('remote branches and renaming', () => {
    test('deletes a branch on the remote', async () => {
        const repo = TemporaryRepository.createWithRemote();
        repos.push(repo);
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.publish('main');
        repo.branch('feature/doomed');
        commitFile(repo, 'doomed.txt', 'doomed\n', 'work');
        repo.publish('feature/doomed');
        repo.checkout('main');

        expect(repo.remoteBranches()).toContain('feature/doomed');

        await new GitCliWriter(repo.path).perform({
            type: 'deleteRemoteBranch',
            remote: 'origin',
            branch: 'feature/doomed',
        });

        expect(repo.remoteBranches()).not.toContain('feature/doomed');
        // The local branch is untouched: deleting on the remote is not deleting here.
        expect((await read(repo)).getBranch('feature/doomed')).toBeDefined();
    });

    test('renames a local branch, keeping its commits', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature/old-name');
        const head = commitFile(repo, 'work.txt', 'work\n', 'work');
        repo.checkout('main');

        await new GitCliWriter(repo.path).perform({
            type: 'renameBranch',
            from: 'feature/old-name',
            to: 'feature/new-name',
        });

        const result = await read(repo);
        expect(result.getBranch('feature/old-name')).toBeUndefined();
        expect(result.getBranch('feature/new-name')?.headCommitHash).toBe(head);
    });

    test('renames the branch currently checked out', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature/current');

        await new GitCliWriter(repo.path).perform({
            type: 'renameBranch',
            from: 'feature/current',
            to: 'feature/renamed',
        });

        expect((await read(repo)).currentBranch?.name).toBe('feature/renamed');
    });

    test('refuses to rename over an existing branch', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature/a');
        repo.checkout('main');
        repo.branch('feature/b');
        repo.checkout('main');

        // -m rather than -M, so git protects the existing branch.
        await expect(
            new GitCliWriter(repo.path).perform({
                type: 'renameBranch',
                from: 'feature/a',
                to: 'feature/b',
            })
        ).rejects.toThrow(GitActionFailedError);

        expect((await read(repo)).getBranch('feature/a')).toBeDefined();
    });
});
