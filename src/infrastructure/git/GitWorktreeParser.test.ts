import { describe, expect, test } from 'vitest';
import { GitWorktreeParser } from './GitWorktreeParser';

/**
 * The samples here are copied from real `git worktree list --porcelain` output,
 * including the trailing blank line git emits after the last record.
 */
const TWO_WORKTREES = `worktree /private/tmp/repo
HEAD 3dd421715a520899935828c6afe3d5c434e58603
branch refs/heads/main

worktree /private/tmp/repo-wt
HEAD 3dd421715a520899935828c6afe3d5c434e58603
branch refs/heads/worktree-branch

`;

describe('GitWorktreeParser', () => {
    test('reads each record', () => {
        const worktrees = GitWorktreeParser.parse(TWO_WORKTREES);

        expect(worktrees.map((w) => w.path)).toEqual([
            '/private/tmp/repo',
            '/private/tmp/repo-wt',
        ]);
        expect(worktrees.map((w) => w.branch)).toEqual([
            'main',
            'worktree-branch',
        ]);
    });

    test('the first record is the main worktree, and only the first', () => {
        // Git always lists it first; nothing in the record itself says so.
        const worktrees = GitWorktreeParser.parse(TWO_WORKTREES);

        expect(worktrees.map((w) => w.isMain)).toEqual([true, false]);
    });

    test('shortens the branch ref, which arrives in full here', () => {
        // Unlike %(refname:short) elsewhere, this format gives refs/heads/x.
        expect(GitWorktreeParser.parse(TWO_WORKTREES)[0].branch).toBe('main');
    });

    test('marks the current worktree by comparing git output with git output', () => {
        const worktrees = GitWorktreeParser.parse(
            TWO_WORKTREES,
            '/private/tmp/repo-wt'
        );

        expect(worktrees.map((w) => w.isCurrent)).toEqual([false, true]);
    });

    test('marks nothing current when the current path is unknown', () => {
        // A bare repository has no working tree, so --show-toplevel fails.
        const worktrees = GitWorktreeParser.parse(TWO_WORKTREES);

        expect(worktrees.some((w) => w.isCurrent)).toBe(false);
    });

    test('reads a detached worktree as having no branch', () => {
        const worktrees = GitWorktreeParser.parse(
            `worktree /r
HEAD abc123
detached
`
        );

        expect(worktrees[0].branch).toBeUndefined();
        expect(worktrees[0].isDetached).toBe(true);
    });

    test('reads a bare repository', () => {
        const worktrees = GitWorktreeParser.parse(`worktree /srv/repo.git
bare
`);

        expect(worktrees[0].isBare).toBe(true);
        expect(worktrees[0].checkedOut).toBe('bare repository');
    });

    test('reads a lock with its reason', () => {
        const worktrees = GitWorktreeParser.parse(`worktree /r
HEAD abc
branch refs/heads/main
locked on an external drive
`);

        expect(worktrees[0].isLocked).toBe(true);
        expect(worktrees[0].lockReason).toBe('on an external drive');
    });

    test('reads a lock with no reason', () => {
        // `locked` on its own is a bare flag, and must not become the reason "".
        const worktrees = GitWorktreeParser.parse(`worktree /r
HEAD abc
locked
`);

        expect(worktrees[0].isLocked).toBe(true);
        expect(worktrees[0].lockReason).toBeUndefined();
    });

    test('reads prunable with its reason', () => {
        const worktrees = GitWorktreeParser.parse(`worktree /r
HEAD abc
branch refs/heads/spike
prunable gitdir file points to non-existent location
`);

        expect(worktrees[0].isPrunable).toBe(true);
        expect(worktrees[0].prunableReason).toBe(
            'gitdir file points to non-existent location'
        );
    });

    test('keeps a path containing spaces intact', () => {
        // Only the first token is the keyword; the rest of the line is the value.
        const worktrees = GitWorktreeParser.parse(
            `worktree /Users/me/My Projects/repo
HEAD abc
`
        );

        expect(worktrees[0].path).toBe('/Users/me/My Projects/repo');
    });

    test('ignores an attribute it does not know', () => {
        // Git has extended this format before and may again; an unknown line
        // must not lose the record.
        const worktrees = GitWorktreeParser.parse(`worktree /r
HEAD abc
branch refs/heads/main
somethingnew whatever
`);

        expect(worktrees).toHaveLength(1);
        expect(worktrees[0].branch).toBe('main');
    });

    test('skips a record with no path', () => {
        const worktrees = GitWorktreeParser.parse(`HEAD abc
branch refs/heads/main
`);

        expect(worktrees).toEqual([]);
    });

    test('returns nothing for empty output', () => {
        expect(GitWorktreeParser.parse('')).toEqual([]);
        expect(GitWorktreeParser.parse('\n\n')).toEqual([]);
    });

    test('tolerates carriage returns', () => {
        const worktrees = GitWorktreeParser.parse(
            'worktree /r\r\nHEAD abc\r\nbranch refs/heads/main\r\n'
        );

        expect(worktrees[0].path).toBe('/r');
        expect(worktrees[0].branch).toBe('main');
    });
});
