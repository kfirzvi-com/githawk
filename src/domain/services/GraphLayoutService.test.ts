import { expect, test } from 'vitest';
import { GraphLayoutService } from './GraphLayoutService';
import { commits } from '../testing/commitFactory';

const layout = (input: Parameters<typeof commits>) =>
    new GraphLayoutService().layout(commits(...input));

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
