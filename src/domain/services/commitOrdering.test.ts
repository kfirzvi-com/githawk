import { describe, expect, test } from 'vitest';
import { orderTopologically } from './commitOrdering';
import { commits } from '../testing/commitFactory';
import type { Commit } from '../models/Commit';

const hashes = (ordered: Commit[]) => ordered.map((c) => c.hash);

/** Asserts the one invariant that matters: no parent above its own child. */
function expectTopologicallySound(ordered: Commit[]): void {
    const rowOf = new Map(ordered.map((c, row) => [c.hash, row]));

    for (const commit of ordered) {
        const childRow = rowOf.get(commit.hash)!;
        for (const parentHash of commit.parentHashes) {
            const parentRow = rowOf.get(parentHash);
            if (parentRow === undefined) {
                continue;
            }
            expect(
                parentRow,
                `${parentHash} (row ${parentRow}) must sit below its child ${commit.hash} (row ${childRow})`
            ).toBeGreaterThan(childRow);
        }
    }
}

describe('orderTopologically', () => {
    test('orders a linear history newest first', () => {
        const ordered = orderTopologically(
            commits(
                { hash: 'a1', timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'b2', parentHashes: ['a1'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'c3', parentHashes: ['b2'], timestamp: '2023-01-03T10:00:00Z' }
            )
        );

        expect(hashes(ordered)).toEqual(['c3', 'b2', 'a1']);
    });

    test('keeps a rebased parent below its child despite a later date', () => {
        // A rebase rewrites the child but preserves the original author date on
        // the parent, so the parent can legitimately carry the LATER timestamp.
        // A plain date sort puts a1 first and draws the history upside down.
        const input = commits(
            { hash: 'a1', timestamp: '2023-06-01T10:00:00Z' },
            { hash: 'b2', parentHashes: ['a1'], timestamp: '2023-01-02T10:00:00Z' }
        );

        const ordered = orderTopologically(input);

        expect(hashes(ordered)).toEqual(['b2', 'a1']);
        expectTopologicallySound(ordered);
    });

    test('handles a cherry-pick that back-dates a whole run of commits', () => {
        const ordered = orderTopologically(
            commits(
                { hash: 'root', timestamp: '2023-01-01T00:00:00Z' },
                { hash: 'old1', parentHashes: ['root'], timestamp: '2024-05-01T00:00:00Z' },
                { hash: 'old2', parentHashes: ['old1'], timestamp: '2023-02-01T00:00:00Z' },
                { hash: 'old3', parentHashes: ['old2'], timestamp: '2023-03-01T00:00:00Z' },
                { hash: 'tip', parentHashes: ['old3'], refs: ['main'], timestamp: '2023-04-01T00:00:00Z' }
            )
        );

        expect(hashes(ordered)).toEqual(['tip', 'old3', 'old2', 'old1', 'root']);
        expectTopologicallySound(ordered);
    });

    test('places both sides of a merge below the merge commit', () => {
        const ordered = orderTopologically(
            commits(
                { hash: 'a1', timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'b2', parentHashes: ['a1'], timestamp: '2023-01-02T10:00:00Z' },
                // The feature branch was authored long before the mainline commit
                // it merges into, yet must still sit below the merge.
                { hash: 'f1', parentHashes: ['a1'], timestamp: '2022-11-01T10:00:00Z' },
                { hash: 'm3', parentHashes: ['b2', 'f1'], refs: ['main'], timestamp: '2023-01-03T10:00:00Z' }
            )
        );

        expect(ordered[0].hash).toBe('m3');
        expectTopologicallySound(ordered);
    });

    test('ignores parents outside the loaded window', () => {
        const ordered = orderTopologically(
            commits(
                { hash: 'b2', parentHashes: ['a1-not-loaded'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'c3', parentHashes: ['b2'], timestamp: '2023-01-03T10:00:00Z' }
            )
        );

        expect(hashes(ordered)).toEqual(['c3', 'b2']);
    });

    test('is stable when timestamps collide', () => {
        const sameInstant = '2023-01-01T10:00:00Z';
        const input = commits(
            { hash: 'aaa', timestamp: sameInstant },
            { hash: 'bbb', timestamp: sameInstant },
            { hash: 'ccc', timestamp: sameInstant }
        );

        const first = hashes(orderTopologically(input));
        const second = hashes(orderTopologically([...input].reverse()));

        expect(first).toEqual(second);
    });

    test('returns every commit for an octopus merge', () => {
        const ordered = orderTopologically(
            commits(
                { hash: 'base', timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'p1', parentHashes: ['base'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'p2', parentHashes: ['base'], timestamp: '2023-01-03T10:00:00Z' },
                { hash: 'p3', parentHashes: ['base'], timestamp: '2023-01-04T10:00:00Z' },
                { hash: 'octo', parentHashes: ['p1', 'p2', 'p3'], refs: ['main'], timestamp: '2023-01-05T10:00:00Z' }
            )
        );

        expect(ordered).toHaveLength(5);
        expect(ordered[0].hash).toBe('octo');
        expectTopologicallySound(ordered);
    });

    test('still returns everything when history contains a cycle', () => {
        // Impossible in git, but the layout must degrade rather than blank out.
        const ordered = orderTopologically(
            commits(
                { hash: 'x', parentHashes: ['y'], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'y', parentHashes: ['x'], timestamp: '2023-01-02T10:00:00Z' }
            )
        );

        expect(hashes(ordered).sort()).toEqual(['x', 'y']);
    });

    test('handles empty and single-commit input', () => {
        expect(orderTopologically([])).toEqual([]);
        expect(
            hashes(orderTopologically(commits({ hash: 'only', timestamp: '2023-01-01T10:00:00Z' })))
        ).toEqual(['only']);
    });

    test('orders ten thousand commits without stack overflow', () => {
        const many = commits(
            ...Array.from({ length: 10_000 }, (_, i) => ({
                hash: `c${i}`,
                parentHashes: i === 0 ? [] : [`c${i - 1}`],
                // Deliberately shuffled dates, so only topology can order this.
                timestamp: new Date(1_600_000_000_000 + ((i * 7919) % 100_000) * 1000),
            }))
        );

        const ordered = orderTopologically(many);

        expect(ordered).toHaveLength(10_000);
        expect(ordered[0].hash).toBe('c9999');
        expect(ordered[9_999].hash).toBe('c0');
        expectTopologicallySound(ordered);
    });
});
