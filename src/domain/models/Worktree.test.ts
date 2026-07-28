import { describe, expect, test } from 'vitest';
import { Worktree } from './Worktree';

describe('Worktree', () => {
    test('requires a path, which is its identity', () => {
        expect(() => new Worktree({ path: '' })).toThrow();
        expect(() => new Worktree({ path: '   ' })).toThrow();
    });

    test('is named after its directory', () => {
        expect(new Worktree({ path: '/projects/gitgrit-readme' }).name).toBe(
            'gitgrit-readme'
        );
    });

    test('a bare repository has nothing checked out', () => {
        // Carrying a HEAD or a branch would be a contradiction, so they are
        // dropped rather than trusted.
        const bare = new Worktree({
            path: '/srv/repo.git',
            isBare: true,
            head: 'a'.repeat(40),
            branch: 'main',
        });

        expect(bare.head).toBeUndefined();
        expect(bare.branch).toBeUndefined();
        expect(bare.checkedOut).toBe('bare repository');
        // Not detached either: there is no working tree to detach.
        expect(bare.isDetached).toBe(false);
    });

    test('no branch means detached', () => {
        const detached = new Worktree({
            path: '/projects/wt',
            head: 'abcdef1234567890',
        });

        expect(detached.isDetached).toBe(true);
        expect(detached.checkedOut).toBe('detached at abcdef12');
    });

    test('describes what it has checked out', () => {
        expect(
            new Worktree({ path: '/w', branch: 'feature/login' }).checkedOut
        ).toBe('feature/login');
    });

    test('the main worktree cannot be removed', () => {
        // Git refuses, and there is nowhere to remove it to: deleting it deletes
        // the repository.
        expect(new Worktree({ path: '/w', isMain: true }).canRemove).toBe(false);
        expect(new Worktree({ path: '/w' }).canRemove).toBe(true);
    });

    test('the main worktree cannot be locked, and a locked one cannot be again', () => {
        expect(new Worktree({ path: '/w', isMain: true }).canLock).toBe(false);
        expect(new Worktree({ path: '/w', isLocked: true }).canLock).toBe(false);
        expect(new Worktree({ path: '/w' }).canLock).toBe(true);
    });

    test('holds only the branch it actually has checked out', () => {
        const worktree = new Worktree({ path: '/w', branch: 'feature/login' });

        expect(worktree.holds('feature/login')).toBe(true);
        expect(worktree.holds('main')).toBe(false);
    });

    test('a detached worktree holds no branch', () => {
        expect(new Worktree({ path: '/w', head: 'abc' }).holds('main')).toBe(
            false
        );
    });

    test('equality is by path', () => {
        const one = new Worktree({ path: '/w', branch: 'main' });
        const other = new Worktree({ path: '/w', branch: 'other' });

        expect(one.equals(other)).toBe(true);
    });
});
