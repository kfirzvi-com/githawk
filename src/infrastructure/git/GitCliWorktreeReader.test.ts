import { existsSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { GitCliRepository } from './GitCliRepository';
import { GitCliWorktreeReader } from './GitCliWorktreeReader';
import { TemporaryRepository } from './testing/temporaryRepository';

/**
 * Against real `git worktree`, because every claim here is about git's
 * behaviour: which record is main, what a linked worktree's `.git` looks like,
 * and — the one that matters most — that git refuses to check out a branch which
 * already lives in another working tree.
 */
describe('GitCliWorktreeReader', () => {
    let repo: TemporaryRepository;

    afterEach(() => {
        repo?.dispose();
    });

    /** A linked worktree beside the repository, on a new branch. */
    const addWorktree = (name: string, branch: string): string => {
        const path = `${repo.path}-${name}`;
        repo.git(['worktree', 'add', '--quiet', path, '-b', branch]);
        return path;
    };

    const cleanUp = (path: string) => {
        rmSync(path, { recursive: true, force: true });
    };

    test('a repository with no linked worktrees has exactly one', () => {
        repo = TemporaryRepository.create();
        repo.commit('first');

        return new GitCliWorktreeReader(repo.path).list().then((worktrees) => {
            expect(worktrees).toHaveLength(1);
            expect(worktrees[0].isMain).toBe(true);
            expect(worktrees[0].isCurrent).toBe(true);
            expect(worktrees[0].branch).toBe('main');
        });
    });

    test('lists a linked worktree with its own branch', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        try {
            const worktrees = await new GitCliWorktreeReader(repo.path).list();

            expect(worktrees).toHaveLength(2);
            const linked = worktrees.find((w) => !w.isMain);
            expect(linked?.branch).toBe('feature/side');
            expect(linked?.isCurrent).toBe(false);
            // Git resolves symlinks, so the path is not the one we passed in on
            // a Mac — the name is what survives comparison.
            expect(linked?.name).toBe(`${basename(repo.path)}-wt`);
        } finally {
            cleanUp(path);
        }
    });

    test('marks the worktree being read as current, whichever it is', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        try {
            // Read from inside the linked worktree, not the main one.
            const worktrees = await new GitCliWorktreeReader(path).list();
            const current = worktrees.find((w) => w.isCurrent);

            expect(current?.branch).toBe('feature/side');
            expect(current?.isMain).toBe(false);
        } finally {
            cleanUp(path);
        }
    });

    test('a linked worktree keeps its .git as a file, not a directory', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        try {
            // The fact the repository scan depends on.
            expect(existsSync(`${path}/.git`)).toBe(true);
            const worktrees = await new GitCliWorktreeReader(repo.path).list();
            expect(worktrees).toHaveLength(2);
        } finally {
            cleanUp(path);
        }
    });

    test('reads a lock and its reason', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        try {
            repo.git(['worktree', 'lock', '--reason', 'on a usb stick', path]);
            const worktrees = await new GitCliWorktreeReader(repo.path).list();
            const linked = worktrees.find((w) => !w.isMain);

            expect(linked?.isLocked).toBe(true);
            expect(linked?.lockReason).toBe('on a usb stick');
            expect(linked?.canLock).toBe(false);
        } finally {
            repo.git(['worktree', 'unlock', path]);
            cleanUp(path);
        }
    });

    test('reports a worktree whose directory was deleted by hand as prunable', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        // The situation that wastes people's time: the directory is gone, the
        // record is not, and git keeps refusing the branch until it is pruned.
        cleanUp(path);

        const worktrees = await new GitCliWorktreeReader(repo.path).list();
        const stale = worktrees.find((w) => !w.isMain);

        expect(stale?.isPrunable).toBe(true);
        expect(stale?.branch).toBe('feature/side');
    });

    test('a detached worktree has no branch', async () => {
        repo = TemporaryRepository.create();
        const head = repo.commit('first');
        const path = `${repo.path}-detached`;
        repo.git(['worktree', 'add', '--quiet', '--detach', path, head]);

        try {
            const worktrees = await new GitCliWorktreeReader(repo.path).list();
            const detached = worktrees.find((w) => !w.isMain);

            expect(detached?.isDetached).toBe(true);
            expect(detached?.branch).toBeUndefined();
        } finally {
            cleanUp(path);
        }
    });

    test('the branch listing says which worktree holds a branch', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        const path = addWorktree('wt', 'feature/side');

        try {
            const repository = await new GitCliRepository({
                cwd: repo.path,
            }).getRepository();

            const side = repository.getBranch('feature/side');
            // This is what makes an unavailable checkout visible without a
            // second git command per branch.
            expect(side?.isCheckedOutElsewhere).toBe(true);
            expect(side?.worktreePath).toBeTruthy();

            const main = repository.getBranch('main');
            // main is checked out here, so it has a worktreePath too — and must
            // not be reported as unavailable.
            expect(main?.isCurrent).toBe(true);
            expect(main?.isCheckedOutElsewhere).toBe(false);
        } finally {
            cleanUp(path);
        }
    });

    test('a branch checked out nowhere has no worktree path', async () => {
        repo = TemporaryRepository.create();
        repo.commit('first');
        repo.git(['branch', 'idle']);

        const repository = await new GitCliRepository({
            cwd: repo.path,
        }).getRepository();

        expect(repository.getBranch('idle')?.worktreePath).toBeUndefined();
        expect(repository.getBranch('idle')?.isCheckedOutElsewhere).toBe(false);
    });
});

function basename(path: string): string {
    const segments = path.split('/');
    return segments[segments.length - 1];
}
