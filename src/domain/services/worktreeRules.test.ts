import { describe, expect, test } from 'vitest';
import { Worktree } from '../models/Worktree';
import {
    blocksCheckout,
    describePathProblem,
    existingWorktreeAt,
    prunableWorktrees,
    slugForBranch,
    suggestWorktreePath,
    worktreeHolding,
} from './worktreeRules';

const main = new Worktree({
    path: '/projects/gitgrit',
    head: 'a'.repeat(40),
    branch: 'main',
    isMain: true,
    isCurrent: true,
});
const linked = new Worktree({
    path: '/projects/gitgrit-readme',
    head: 'b'.repeat(40),
    branch: 'docs/readme',
});
const gone = new Worktree({
    path: '/projects/gitgrit-deleted',
    head: 'c'.repeat(40),
    branch: 'spike/old',
    isPrunable: true,
    prunableReason: 'gitdir file points to non-existent location',
});

const worktrees = [main, linked, gone];

describe('worktreeHolding', () => {
    test('finds the worktree a branch is checked out in', () => {
        expect(worktreeHolding(worktrees, 'docs/readme')).toBe(linked);
    });

    test('finds nothing for a branch checked out nowhere', () => {
        expect(worktreeHolding(worktrees, 'feature/new')).toBeUndefined();
    });
});

describe('blocksCheckout', () => {
    test('names the worktree that will make a checkout fail', () => {
        // Git allows a branch in one working tree at a time.
        expect(blocksCheckout(worktrees, 'docs/readme')).toBe(linked);
    });

    test('the current worktree does not block its own branch', () => {
        // Otherwise the branch you are on would look unavailable to you.
        expect(blocksCheckout(worktrees, 'main')).toBeUndefined();
    });

    test('a stale record still blocks, because git still refuses', () => {
        // The directory is gone but the record is not, and git goes by the
        // record until it is pruned. This is the case that wastes people's time.
        expect(blocksCheckout(worktrees, 'spike/old')).toBe(gone);
    });
});

describe('prunableWorktrees', () => {
    test('is only the ones whose directory git cannot find', () => {
        expect(prunableWorktrees(worktrees)).toEqual([gone]);
    });
});

describe('slugForBranch', () => {
    test('flattens slashes rather than nesting directories', () => {
        // feature/login must not create a stray feature/ folder.
        expect(slugForBranch('feature/login')).toBe('feature-login');
        expect(slugForBranch('release/2026/q1')).toBe('release-2026-q1');
    });

    test('keeps dots and dashes, which are legal in both refs and paths', () => {
        expect(slugForBranch('v1.2-rc')).toBe('v1.2-rc');
    });

    test('collapses runs and trims the edges', () => {
        expect(slugForBranch('feature//login')).toBe('feature-login');
        expect(slugForBranch('-feature-')).toBe('feature');
        expect(slugForBranch('.hidden.')).toBe('hidden');
    });

    test('never returns an empty string', () => {
        // An empty segment would make the suggested path end in a dash.
        expect(slugForBranch('///')).toBe('worktree');
    });
});

describe('suggestWorktreePath', () => {
    test('is a sibling of the repository, named after the branch', () => {
        expect(
            suggestWorktreePath('/projects/gitgrit', 'feature/login')
        ).toBe('/projects/gitgrit-feature-login');
    });

    test('is unaffected by a trailing separator on the repository path', () => {
        expect(suggestWorktreePath('/projects/gitgrit/', 'readme')).toBe(
            '/projects/gitgrit-readme'
        );
    });

    test('never suggests a path inside the repository', () => {
        // Inside, it would show up as untracked in its own parent's git status,
        // and a dot-directory would be invisible to the repository scan.
        const suggested = suggestWorktreePath('/projects/gitgrit', 'x');

        expect(suggested.startsWith('/projects/gitgrit/')).toBe(false);
    });
});

describe('describePathProblem', () => {
    test('rejects an empty path', () => {
        expect(describePathProblem('   ')).toBeTruthy();
    });

    test('rejects a leading dash, which git reads as an option', () => {
        // `git worktree add` has no `--` terminator.
        expect(describePathProblem('/projects/-wt')).toMatch(/option/);
    });

    test('accepts an ordinary path', () => {
        expect(describePathProblem('/projects/gitgrit-wt')).toBeUndefined();
    });

    test('a dash inside a segment is fine', () => {
        expect(describePathProblem('/projects/git-hawk-wt')).toBeUndefined();
    });
});

describe('existingWorktreeAt', () => {
    test('catches a path git would refuse, and says what is there', () => {
        expect(existingWorktreeAt(worktrees, '/projects/gitgrit-readme')).toBe(
            linked
        );
    });

    test('ignores a trailing separator on either side', () => {
        expect(existingWorktreeAt(worktrees, '/projects/gitgrit-readme/')).toBe(
            linked
        );
    });

    test('finds nothing for a free path', () => {
        expect(
            existingWorktreeAt(worktrees, '/projects/gitgrit-new')
        ).toBeUndefined();
    });
});
