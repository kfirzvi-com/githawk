import { describe, expect, it } from 'vitest';
import { Commit } from './Commit';
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
        const refs = ['main'];
        const commit = new Commit({
            hash: 'abc123',
            message: 'msg',
            author: 'author',
            parentHashes,
            refs,
            timestamp: new Date('2023-01-01T10:00:00Z'),
        });

        parentHashes.push('injected');
        refs.push('injected');

        expect(commit.parentHashes).toEqual(['parent1']);
        expect(commit.refs).toEqual(['main']);
    });
});
