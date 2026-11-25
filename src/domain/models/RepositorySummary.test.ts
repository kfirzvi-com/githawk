import { describe, expect, it } from 'vitest';
import {
    RepositorySummary,
    describeSummary,
    explainSummary,
    hasUncommittedChanges,
} from './RepositorySummary';
import { cleanWorkingTree } from './WorkingTreeStatus';

const summary = (overrides: Partial<RepositorySummary> = {}): RepositorySummary => ({
    head: 'main',
    detached: false,
    unborn: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    status: { ...cleanWorkingTree },
    changedFiles: 0,
    ...overrides,
});

describe('describeSummary', () => {
    it('is just the branch when there is nothing to say', () => {
        expect(describeSummary(summary())).toBe('main');
    });

    it('adds the changed files and the distance from the upstream', () => {
        expect(
            describeSummary(
                summary({
                    changedFiles: 4,
                    status: { ...cleanWorkingTree, unstaged: 4 },
                    ahead: 1,
                    behind: 2,
                })
            )
        ).toBe('main · 4 changed · ↑1 ↓2');
    });

    it('says how many of the changes are conflicts', () => {
        expect(
            describeSummary(
                summary({
                    changedFiles: 3,
                    status: { ...cleanWorkingTree, conflicted: 1, unstaged: 2 },
                })
            )
        ).toBe('main · 3 changed, 1 conflicted');
    });

    it('shows only the arrow that has something behind it', () => {
        expect(describeSummary(summary({ behind: 3 }))).toBe('main · ↓3');
    });
});

describe('hasUncommittedChanges', () => {
    it('ignores commits not yet pushed: they are already committed', () => {
        expect(hasUncommittedChanges(summary({ ahead: 5 }))).toBe(false);
        expect(hasUncommittedChanges(summary({ changedFiles: 1 }))).toBe(true);
    });
});

describe('explainSummary', () => {
    it('spells out each fact in words', () => {
        expect(
            explainSummary(
                summary({
                    ahead: 1,
                    behind: 2,
                    changedFiles: 2,
                    status: { ...cleanWorkingTree, staged: 1, untracked: 1 },
                })
            )
        ).toEqual([
            'On main',
            '1 commit to push, 2 commits to pull (origin/main)',
            '2 files changed: 1 staged, 1 untracked',
        ]);
    });

    it('says when a branch tracks nothing, or HEAD is detached', () => {
        expect(explainSummary(summary({ upstream: undefined }))[1]).toBe(
            'Not tracking a remote branch'
        );
        expect(
            explainSummary(summary({ head: 'abc1234', detached: true, upstream: undefined }))
        ).toEqual(['HEAD is detached at abc1234', 'Nothing uncommitted']);
    });
});
