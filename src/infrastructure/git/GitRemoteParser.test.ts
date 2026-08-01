import { describe, expect, it } from 'vitest';
import { GitRemoteParser } from './GitRemoteParser';

describe('GitRemoteParser', () => {
    it('reads a remote from its two lines', () => {
        const remotes = GitRemoteParser.parse(
            [
                'origin\tgit@github.com:owner/repo.git (fetch)',
                'origin\tgit@github.com:owner/repo.git (push)',
            ].join('\n')
        );

        expect(remotes).toHaveLength(1);
        expect(remotes[0].name).toBe('origin');
        expect(remotes[0].fetchUrl).toBe('git@github.com:owner/repo.git');
        expect(remotes[0].hasSeparatePushUrl).toBe(false);
    });

    it('keeps fetch and push apart when they differ', () => {
        // The fork workflow: read from upstream, write to your own copy.
        const remotes = GitRemoteParser.parse(
            [
                'origin\thttps://github.com/upstream/repo.git (fetch)',
                'origin\tgit@github.com:me/repo.git (push)',
            ].join('\n')
        );

        expect(remotes[0].fetchUrl).toBe('https://github.com/upstream/repo.git');
        expect(remotes[0].pushUrl).toBe('git@github.com:me/repo.git');
        expect(remotes[0].hasSeparatePushUrl).toBe(true);
    });

    it('lists several remotes in the order git printed them', () => {
        const remotes = GitRemoteParser.parse(
            [
                'origin\tgit@github.com:me/repo.git (fetch)',
                'origin\tgit@github.com:me/repo.git (push)',
                'upstream\tgit@github.com:owner/repo.git (fetch)',
                'upstream\tgit@github.com:owner/repo.git (push)',
            ].join('\n')
        );

        expect(remotes.map((r) => r.name)).toEqual(['origin', 'upstream']);
    });

    it('handles a local path as a URL', () => {
        // What every test repository here uses, and what people use for a
        // shared drive or a bare mirror.
        // Including a space in it, which a directory is entitled to have and
        // which a URL grammar would reject.
        const remotes = GitRemoteParser.parse(
            'origin\t/tmp/some repo-remote (fetch)\norigin\t/tmp/some repo-remote (push)'
        );

        expect(remotes[0].fetchUrl).toBe('/tmp/some repo-remote');
    });

    it('returns nothing for a repository with no remotes', () => {
        expect(GitRemoteParser.parse('')).toEqual([]);
        expect(GitRemoteParser.parse('\n\n')).toEqual([]);
    });

    it('ignores a line it cannot make sense of', () => {
        // Better to list the remotes it did understand than to fail entirely.
        const remotes = GitRemoteParser.parse(
            [
                'nonsense',
                'origin\tgit@github.com:owner/repo.git (fetch)',
            ].join('\n')
        );

        expect(remotes.map((r) => r.name)).toEqual(['origin']);
    });
});
