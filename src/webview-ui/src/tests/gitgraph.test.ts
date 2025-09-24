import { expect, test } from 'vitest';
import { Commit } from '../lib/domain/commit.js';
import { GraphBuilder } from '../lib/domain/graph-builder.js';

test('Test git graph generation for a single commit', () => {
    const commits: Commit[] = [
        { hash: 'a1', parentHashes: [], refs: ['main'], message: 'Initial commit', timestamp: new Date('2023-01-01T10:00:00Z').toISOString() },
    ];

    const graphBuilder = new GraphBuilder();
    const gitGraph = graphBuilder.buildGraph(commits);

    expect(gitGraph.commits.length).toBe(1);
    expect(gitGraph.nodes.length).toBe(1);
    expect(gitGraph.nodes).toContainEqual({ hash: 'a1', row: 0, lane: 0 });
    expect(gitGraph.edges.length).toBe(0);
}
);

test('Test git graph generation for two commits', () => {
    const commits: Commit[] = [
        { hash: 'a1', parentHashes: [], refs: ['main'], message: 'Initial commit', timestamp: new Date('2023-01-01T10:00:00Z').toISOString() },
        { hash: 'b2', parentHashes: ['a1'], refs: [], message: 'Second commit', timestamp: new Date('2023-01-02T10:00:00Z').toISOString() },
    ];

    const graphBuilder = new GraphBuilder();
    const gitGraph = graphBuilder.buildGraph(commits);

    expect(gitGraph.commits.length).toBe(2);
    expect(gitGraph.nodes.length).toBe(2);
    expect(gitGraph.nodes).toContainEqual({ hash: 'a1', row: 0, lane: 0 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'b2', row: 1, lane: 0 });
    expect(gitGraph.edges.length).toBe(1);
    expect(gitGraph.edges[0]).toEqual({ row: 0, fromLane: 0, toLane: 0 });
});

test('Test git graph generation for an open branch from main', () => {
    const commits: Commit[] = [
        { hash: 'a1', parentHashes: [], refs: ['main'], message: 'Initial commit', timestamp: new Date('2023-01-01T10:00:00Z').toISOString() },
        { hash: 'b2', parentHashes: ['a1'], refs: [], message: 'Second commit', timestamp: new Date('2023-01-02T10:00:00Z').toISOString() },
        { hash: 'c3', parentHashes: ['a1'], refs: ['feature'], message: 'Feature commit', timestamp: new Date('2023-01-03T10:00:00Z').toISOString() },
    ];

    const graphBuilder = new GraphBuilder();
    const gitGraph = graphBuilder.buildGraph(commits);

    expect(gitGraph.commits.length).toBe(3);
    expect(gitGraph.nodes.length).toBe(3);
    expect(gitGraph.nodes).toContainEqual({ hash: 'a1', row: 0, lane: 0 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'b2', row: 1, lane: 0 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'c3', row: 2, lane: 1 });

    expect(gitGraph.edges.length).toBe(3);
    expect(gitGraph.edges).toContainEqual({ row: 0, fromLane: 0, toLane: 0 });
    expect(gitGraph.edges).toContainEqual({ row: 0, fromLane: 0, toLane: 1 });
    expect(gitGraph.edges).toContainEqual({ row: 1, fromLane: 1, toLane: 1 });
});

test('Test git graph generation for an open branch from main and a merge back to main', () => {
    const commits: Commit[] = [
        { hash: 'a1', parentHashes: [], refs: [], message: 'Initial commit', timestamp: new Date('2023-01-01T10:00:00Z').toISOString() },
        { hash: 'b2', parentHashes: ['a1'], refs: [], message: 'Second commit', timestamp: new Date('2023-01-02T10:00:00Z').toISOString() },
        { hash: 'c3', parentHashes: ['a1'], refs: ['feature'], message: 'Feature commit', timestamp: new Date('2023-01-03T10:00:00Z').toISOString() },
        { hash: 'd4', parentHashes: ['b2', 'c3'], refs: ['main'], message: 'Merge feature into main', timestamp: new Date('2023-01-04T10:00:00Z').toISOString() },
    ];

    const graphBuilder = new GraphBuilder();
    const gitGraph = graphBuilder.buildGraph(commits);

    expect(gitGraph.commits.length).toBe(4);
    expect(gitGraph.nodes.length).toBe(4);
    expect(gitGraph.nodes).toContainEqual({ hash: 'a1', row: 0, lane: 0 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'b2', row: 1, lane: 0 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'c3', row: 2, lane: 1 });
    expect(gitGraph.nodes).toContainEqual({ hash: 'd4', row: 3, lane: 0 });

    expect(gitGraph.edges.length).toBe(6);
    expect(gitGraph.edges).toContainEqual({ row: 0, fromLane: 0, toLane: 0 });
    expect(gitGraph.edges).toContainEqual({ row: 0, fromLane: 0, toLane: 1 });
    expect(gitGraph.edges).toContainEqual({ row: 1, fromLane: 1, toLane: 1 });
    expect(gitGraph.edges).toContainEqual({ row: 1, fromLane: 0, toLane: 0 });
    expect(gitGraph.edges).toContainEqual({ row: 2, fromLane: 1, toLane: 0 });
    expect(gitGraph.edges).toContainEqual({ row: 2, fromLane: 0, toLane: 0 });
});