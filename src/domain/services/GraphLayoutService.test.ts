import { describe, expect, test } from 'vitest';
import { GraphLayoutService } from './GraphLayoutService';
import { commits } from '../testing/commitFactory';

const layout = (
    input: Parameters<typeof commits>,
    primaryBranchName?: string
) =>
    new GraphLayoutService().layout(commits(...input), { primaryBranchName });

const maxLaneOf = (graph: { nodes: { lane: number }[] }) =>
    Math.max(...graph.nodes.map((n) => n.lane));

const laneOf = (
    graph: { nodes: { hash: string; lane: number }[] },
    hash: string
) => graph.nodes.find((n) => n.hash === hash)!.lane;

test('a single commit occupies row 0, lane 0, with no edges', () => {
    const graph = layout([
        { hash: 'a1', parentHashes: [], refs: ['main'], timestamp: '2023-01-01T10:00:00Z' },
    ]);

    expect(graph.commits.length).toBe(1);
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes).toContainEqual({ hash: 'a1', row: 0, lane: 0 });
    expect(graph.edges.length).toBe(0);
});

test('two linear commits stack newest-first in one lane', () => {
    const graph = layout([
        { hash: 'a1', parentHashes: [], refs: [], timestamp: '2023-01-01T10:00:00Z' },
        { hash: 'b2', parentHashes: ['a1'], refs: ['main'], timestamp: '2023-01-02T10:00:00Z' },
    ]);

    expect(graph.commits.length).toBe(2);
    expect(graph.nodes.length).toBe(2);
    expect(graph.nodes).toContainEqual({ hash: 'b2', row: 0, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'a1', row: 1, lane: 0 });
    expect(graph.edges.length).toBe(1);
    expect(graph.edges[0]).toEqual({ row: 1, fromLane: 0, toLane: 0 });
});

test('an open branch off main takes the next lane', () => {
    const graph = layout([
        { hash: 'a1', parentHashes: [], refs: [], timestamp: '2023-01-01T10:00:00Z' },
        { hash: 'b2', parentHashes: ['a1'], refs: ['main'], timestamp: '2023-01-02T10:00:00Z' },
        { hash: 'c3', parentHashes: ['a1'], refs: ['feature'], timestamp: '2023-01-03T10:00:00Z' },
    ]);

    expect(graph.commits.length).toBe(3);
    expect(graph.nodes.length).toBe(3);
    expect(graph.nodes).toContainEqual({ hash: 'c3', row: 0, lane: 1 });
    expect(graph.nodes).toContainEqual({ hash: 'b2', row: 1, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'a1', row: 2, lane: 0 });

    expect(graph.edges.length).toBe(3);
    expect(graph.edges).toContainEqual({ row: 1, fromLane: 1, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 0, toLane: 1 });
});

test('a branch that merges back to main rejoins lane 0', () => {
    const graph = layout([
        { hash: 'a1', parentHashes: [], refs: [], timestamp: '2023-01-01T10:00:00Z' },
        { hash: 'b2', parentHashes: ['a1'], refs: [], timestamp: '2023-01-02T10:00:00Z' },
        { hash: 'c3', parentHashes: ['a1'], refs: ['feature'], timestamp: '2023-01-03T10:00:00Z' },
        { hash: 'd4', parentHashes: ['b2', 'c3'], refs: ['main'], timestamp: '2023-01-04T10:00:00Z' },
    ]);

    expect(graph.commits.length).toBe(4);
    expect(graph.nodes.length).toBe(4);
    expect(graph.nodes).toContainEqual({ hash: 'd4', row: 0, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'c3', row: 1, lane: 1 });
    expect(graph.nodes).toContainEqual({ hash: 'b2', row: 2, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'a1', row: 3, lane: 0 });

    expect(graph.edges.length).toBe(6);
    expect(graph.edges).toContainEqual({ row: 3, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 3, fromLane: 0, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 1, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 1, fromLane: 1, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 1, fromLane: 0, toLane: 0 });
});

test('a multi-commit feature branch carries its lane across every row', () => {
    const graph = layout([
        { hash: 'a1', parentHashes: [], refs: [], timestamp: '2023-01-01T10:00:00Z' },
        { hash: 'b2', parentHashes: ['a1'], refs: [], timestamp: '2023-01-02T10:00:00Z' },
        { hash: 'c3', parentHashes: ['a1'], refs: [], timestamp: '2023-01-03T10:00:00Z' },
        { hash: 'c4', parentHashes: ['c3'], refs: ['feature'], timestamp: '2023-01-04T10:00:00Z' },
        { hash: 'd4', parentHashes: ['b2', 'c4'], refs: ['main'], timestamp: '2023-01-05T10:00:00Z' },
    ]);

    expect(graph.commits.length).toBe(5);
    expect(graph.nodes.length).toBe(5);
    expect(graph.nodes).toContainEqual({ hash: 'd4', row: 0, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'c4', row: 1, lane: 1 });
    expect(graph.nodes).toContainEqual({ hash: 'c3', row: 2, lane: 1 });
    expect(graph.nodes).toContainEqual({ hash: 'b2', row: 3, lane: 0 });
    expect(graph.nodes).toContainEqual({ hash: 'a1', row: 4, lane: 0 });

    expect(graph.edges.length).toBe(8);
    expect(graph.edges).toContainEqual({ row: 4, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 4, fromLane: 0, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 3, fromLane: 1, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 3, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 1, toLane: 1 });
    expect(graph.edges).toContainEqual({ row: 2, fromLane: 0, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 1, fromLane: 1, toLane: 0 });
    expect(graph.edges).toContainEqual({ row: 1, fromLane: 0, toLane: 0 });
});

test('a parent outside the loaded page produces no dangling edge', () => {
    const graph = layout([
        { hash: 'b2', parentHashes: ['a1-not-loaded'], refs: ['main'], timestamp: '2023-01-02T10:00:00Z' },
    ]);

    expect(graph.nodes).toContainEqual({ hash: 'b2', row: 0, lane: 0 });
    expect(graph.edges.length).toBe(0);
});

describe('lane reuse', () => {
    test('a second branch reuses the lane the first one vacated', () => {
        // Two feature branches that never coexist. Allocating monotonically
        // would put them in lanes 1 and 2; they belong in the same lane.
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'f1', parentHashes: ['a1'], refs: ['feature1'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'm1', parentHashes: ['a1', 'f1'], timestamp: '2023-01-03T10:00:00Z' },
                { hash: 'f2', parentHashes: ['m1'], refs: ['feature2'], timestamp: '2023-01-04T10:00:00Z' },
                { hash: 'm2', parentHashes: ['m1', 'f2'], refs: ['main'], timestamp: '2023-01-05T10:00:00Z' },
            ],
            'main'
        );

        expect(maxLaneOf(graph)).toBe(1);
        expect(laneOf(graph, 'f1')).toBe(1);
        expect(laneOf(graph, 'f2')).toBe(1);
        // The mainline keeps the spine throughout.
        expect(laneOf(graph, 'm2')).toBe(0);
        expect(laneOf(graph, 'm1')).toBe(0);
        expect(laneOf(graph, 'a1')).toBe(0);
    });

    test('lane count follows concurrent branches, not total branches', () => {
        // Five sequential branches, never overlapping: two lanes total.
        const specs: Parameters<typeof commits> = [
            { hash: 'c0', parentHashes: [], timestamp: '2023-01-01T00:00:00Z' },
        ];
        let mainline = 'c0';
        for (let i = 1; i <= 5; i++) {
            const feature = `f${i}`;
            const merge = `m${i}`;
            specs.push({
                hash: feature,
                parentHashes: [mainline],
                refs: [`feature${i}`],
                timestamp: new Date(Date.UTC(2023, 0, i * 2)),
            });
            specs.push({
                hash: merge,
                parentHashes: [mainline, feature],
                refs: i === 5 ? ['main'] : [],
                timestamp: new Date(Date.UTC(2023, 0, i * 2 + 1)),
            });
            mainline = merge;
        }

        const graph = layout(specs, 'main');

        expect(graph.nodes).toHaveLength(11);
        expect(maxLaneOf(graph)).toBe(1);
    });

    test('branches that genuinely overlap get separate lanes', () => {
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'x1', parentHashes: ['a1'], refs: ['x'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'y1', parentHashes: ['a1'], refs: ['y'], timestamp: '2023-01-03T10:00:00Z' },
                { hash: 'tip', parentHashes: ['a1'], refs: ['main'], timestamp: '2023-01-04T10:00:00Z' },
            ],
            'main'
        );

        // Three tips all pending the same root at once, so three lanes are live.
        expect(maxLaneOf(graph)).toBe(2);
        expect(laneOf(graph, 'tip')).toBe(0);
        expect(new Set([laneOf(graph, 'x1'), laneOf(graph, 'y1')])).toEqual(
            new Set([1, 2])
        );
    });

    test('lane 0 is reserved for the spine even when a branch is newer', () => {
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'main1', parentHashes: ['a1'], refs: ['main'], timestamp: '2023-01-02T10:00:00Z' },
                // Newest commit in the repository, but not on the spine.
                { hash: 'side', parentHashes: ['a1'], refs: ['side'], timestamp: '2023-06-01T10:00:00Z' },
            ],
            'main'
        );

        expect(graph.nodes[0].hash).toBe('side');
        expect(laneOf(graph, 'side')).not.toBe(0);
        expect(laneOf(graph, 'main1')).toBe(0);
        expect(laneOf(graph, 'a1')).toBe(0);
    });

    test('honours a non-conventional primary branch name', () => {
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'dev1', parentHashes: ['a1'], refs: ['our-trunk'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'other', parentHashes: ['a1'], refs: ['main'], timestamp: '2023-01-03T10:00:00Z' },
            ],
            'our-trunk'
        );

        // The supplied name wins over the conventional 'main'.
        expect(laneOf(graph, 'dev1')).toBe(0);
        expect(laneOf(graph, 'other')).not.toBe(0);
    });

    test('every edge segment spans exactly one row', () => {
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'b2', parentHashes: ['a1'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'f1', parentHashes: ['a1'], refs: ['feature'], timestamp: '2023-01-03T10:00:00Z' },
                { hash: 'm1', parentHashes: ['b2', 'f1'], refs: ['main'], timestamp: '2023-01-04T10:00:00Z' },
            ],
            'main'
        );

        const rows = graph.nodes.length;
        for (const edge of graph.edges) {
            // Segments are drawn from `row` up to `row - 1`, so row 0 has none.
            expect(edge.row).toBeGreaterThan(0);
            expect(edge.row).toBeLessThan(rows);
        }
    });

    test('a connection is continuous across every row it spans', () => {
        const graph = layout(
            [
                { hash: 'a1', parentHashes: [], timestamp: '2023-01-01T10:00:00Z' },
                { hash: 'b2', parentHashes: ['a1'], timestamp: '2023-01-02T10:00:00Z' },
                { hash: 'c3', parentHashes: ['b2'], timestamp: '2023-01-03T10:00:00Z' },
                { hash: 'f1', parentHashes: ['a1'], refs: ['feature'], timestamp: '2023-01-04T10:00:00Z' },
                { hash: 'm1', parentHashes: ['c3', 'f1'], refs: ['main'], timestamp: '2023-01-05T10:00:00Z' },
            ],
            'main'
        );

        const rowOf = new Map(graph.nodes.map((n) => [n.hash, n.row]));
        const f1Row = rowOf.get('f1')!;
        const a1Row = rowOf.get('a1')!;

        // f1 -> a1 spans several rows; every gap between them must have a segment.
        for (let row = f1Row + 1; row <= a1Row; row++) {
            expect(
                graph.edges.some((e) => e.row === row),
                `row ${row} has no segment, so the line is broken`
            ).toBe(true);
        }
    });
});
