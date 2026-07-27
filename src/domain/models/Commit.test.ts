import { describe, expect, it } from 'vitest';
import { Commit } from './Commit';
import { localBranchRef } from './Ref';
import { aCommit } from '../testing/commitFactory';

describe('Commit', () => {
    it('exposes the values it was built with', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: 'Initial commit',
            author: 'John Doe',
            refs: ['main'],
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.hash).toBe('abc123');
        expect(commit.message).toBe('Initial commit');
        expect(commit.author).toBe('John Doe');
        expect(commit.shortHash).toBe('abc123');
        expect(commit.isRootCommit).toBe(true);
        expect(commit.isMergeCommit).toBe(false);
    });

    it('rejects an empty hash', () => {
        expect(() => aCommit({ hash: '', timestamp: '2023-01-01T10:00:00Z' })).toThrow(
            'Commit hash cannot be empty'
        );
    });

    it('allows an empty message, as git does', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: '',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.message).toBe('');
    });

    it('identifies merge commits by parent count', () => {
        const merge = aCommit({
            hash: 'abc123',
            message: 'Merge branch feature',
            parentHashes: ['parent1', 'parent2'],
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(merge.isMergeCommit).toBe(true);
        expect(merge.isRootCommit).toBe(false);
        expect(merge.primaryParentHash).toBe('parent1');
    });

    it('resolves branch membership from refs or the branch hint', () => {
        const commit = aCommit({
            hash: 'abc123',
            parentHashes: ['parent1'],
            refs: ['feature/awesome'],
            branchHint: 'feature/awesome',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.hasBranch('feature/awesome')).toBe(true);
        expect(commit.hasBranch('main')).toBe(false);
    });

    it('truncates the hash to eight characters', () => {
        const commit = aCommit({ hash: 'abcdef123456', timestamp: '2023-01-01T10:00:00Z' });

        expect(commit.shortHash).toBe('abcdef12');
    });

    it('copies parent and ref arrays so callers cannot mutate it', () => {
        const parentHashes = ['parent1'];
        const refs = [localBranchRef('main')];
        const commit = new Commit({
            hash: 'abc123',
            message: 'msg',
            author: 'author',
            parentHashes,
            refs,
            timestamp: new Date('2023-01-01T10:00:00Z'),
        });

        parentHashes.push('injected');
        refs.push(localBranchRef('injected'));

        expect(commit.parentHashes).toEqual(['parent1']);
        expect(commit.branchNames).toEqual(['main']);
    });

    it('separates branches, tags, and the checked-out ref', () => {
        const commit = aCommit({
            hash: 'abc123',
            refs: ['main'],
            tags: ['v1.0.0'],
            remotes: ['origin/main'],
            isHead: true,
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.branchNames).toEqual(['main', 'origin/main']);
        expect(commit.tagNames).toEqual(['v1.0.0']);
        expect(commit.isHead).toBe(true);
        // A tag is not a branch, however similar the names look.
        expect(commit.hasBranch('v1.0.0')).toBe(false);
        expect(commit.hasBranch('main')).toBe(true);
    });

    it('orders refs with the checked-out branch first and remotes last', () => {
        const commit = aCommit({
            hash: 'abc123',
            refs: ['zzz-branch', 'main'],
            tags: ['v1.0.0'],
            remotes: ['origin/main'],
            timestamp: '2023-01-01T10:00:00Z',
        });

        const ordered = commit.sortedRefs.map((r) => r.name);
        expect(ordered[ordered.length - 1]).toBe('origin/main');
        expect(ordered).toContain('v1.0.0');
        expect(ordered.indexOf('v1.0.0')).toBeGreaterThan(
            ordered.indexOf('main')
        );
    });
});

describe('Commit message parts', () => {
    it('splits a multi-line message into subject and body', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: 'Add the thing\n\nWhy it was needed.\n\nRefs: #12',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.subject).toBe('Add the thing');
        expect(commit.hasBody).toBe(true);
        expect(commit.body).toBe('Why it was needed.\n\nRefs: #12');
    });

    it('reports no body for a single-line message', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: 'Just the subject',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.subject).toBe('Just the subject');
        expect(commit.body).toBe('');
        expect(commit.hasBody).toBe(false);
    });

    it('preserves indentation inside the body', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: 'Subject\n\n  - first\n  - second',
            timestamp: '2023-01-01T10:00:00Z',
        });

        // Bullet indentation carries meaning, so it must survive.
        expect(commit.body).toBe('- first\n  - second');
    });

    it('copes with an empty message', () => {
        const commit = aCommit({
            hash: 'abc123',
            message: '',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.subject).toBe('');
        expect(commit.hasBody).toBe(false);
    });
});

describe('Commit.wasRewritten', () => {
    it('is false when author and committer match', () => {
        const commit = aCommit({
            hash: 'abc123',
            author: 'Ada',
            committer: 'Ada',
            timestamp: '2023-01-01T10:00:00Z',
            committedAt: '2023-01-01T10:00:00Z',
        });

        expect(commit.wasRewritten).toBe(false);
    });

    it('is true when someone else committed it', () => {
        const commit = aCommit({
            hash: 'abc123',
            author: 'Ada',
            committer: 'Grace',
            timestamp: '2023-01-01T10:00:00Z',
            committedAt: '2023-01-01T10:00:00Z',
        });

        expect(commit.wasRewritten).toBe(true);
    });

    it('is true when the commit date moved, as after a rebase', () => {
        const commit = aCommit({
            hash: 'abc123',
            author: 'Ada',
            committer: 'Ada',
            timestamp: '2023-01-01T10:00:00Z',
            committedAt: '2023-06-01T10:00:00Z',
        });

        expect(commit.wasRewritten).toBe(true);
    });

    it('ignores sub-second differences, which are just clock noise', () => {
        const commit = aCommit({
            hash: 'abc123',
            author: 'Ada',
            committer: 'Ada',
            timestamp: '2023-01-01T10:00:00.000Z',
            committedAt: '2023-01-01T10:00:00.400Z',
        });

        expect(commit.wasRewritten).toBe(false);
    });

    it('is false when there is no committer information at all', () => {
        const commit = aCommit({
            hash: 'abc123',
            timestamp: '2023-01-01T10:00:00Z',
        });

        expect(commit.wasRewritten).toBe(false);
    });
});
