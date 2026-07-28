import { describe, expect, test } from 'vitest';
import { mainWorktreePath, shortWorktreeName } from './worktreeLabels';

describe('shortWorktreeName', () => {
    test('drops the repository prefix, which is the same on every row', () => {
        // The whole point: `githawk-sample-handbook` in a 256px column left the
        // branch beside it rendering as "d…".
        expect(
            shortWorktreeName(
                '/tmp/githawk-sample-handbook',
                '/tmp/githawk-sample'
            )
        ).toBe('handbook');
    });

    test('leaves the main worktree name alone', () => {
        expect(
            shortWorktreeName('/tmp/githawk-sample', '/tmp/githawk-sample')
        ).toBe('githawk-sample');
    });

    test('leaves a name that does not follow the convention alone', () => {
        expect(shortWorktreeName('/elsewhere/scratch', '/tmp/githawk-sample')).toBe(
            'scratch'
        );
    });

    test('never abbreviates to nothing', () => {
        // A directory called exactly `<repo>-` would otherwise lose its label.
        expect(shortWorktreeName('/tmp/repo-', '/tmp/repo')).toBe('repo-');
    });

    test('falls back to the directory name with no main worktree to compare', () => {
        expect(shortWorktreeName('/tmp/githawk-sample-handbook')).toBe(
            'githawk-sample-handbook'
        );
    });

    test('ignores a trailing separator on either side', () => {
        expect(
            shortWorktreeName('/tmp/repo-side/', '/tmp/repo/')
        ).toBe('side');
    });
});

describe('mainWorktreePath', () => {
    test('is the one flagged as main', () => {
        expect(
            mainWorktreePath([
                { path: '/tmp/side', isMain: false },
                { path: '/tmp/repo', isMain: true },
            ])
        ).toBe('/tmp/repo');
    });

    test('is undefined before the host has reported any', () => {
        expect(mainWorktreePath([])).toBeUndefined();
    });
});
