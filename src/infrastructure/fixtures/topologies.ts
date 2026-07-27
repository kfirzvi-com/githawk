import { Branch } from '../../domain/models/Branch';
import { Commit } from '../../domain/models/Commit';
import { GitRepository } from '../../domain/models/GitRepository';
import { commits } from '../../domain/testing/commitFactory';

/**
 * Named repository shapes, each one a graph that is hard to lay out correctly.
 * These drive the unit tests, the dev harness, and the visual snapshots, so a
 * regression shows up as a failing assertion and a changed picture.
 */
export interface Topology {
    id: string;
    label: string;
    /** What this shape is meant to stress. */
    exercises: string;
    build(): GitRepository;
}

const repository = (commitList: Commit[], branchList: Branch[]): GitRepository =>
    new GitRepository(commitList, branchList);

const linear: Topology = {
    id: 'linear',
    label: 'Linear history',
    exercises: 'The base case: one lane, no branching, no merges.',
    build: () =>
        repository(
            commits(
                { hash: 'a1', message: 'Initial commit', author: 'Alice', timestamp: '2023-09-01T09:00:00Z' },
                { hash: 'b2', message: 'Add README', author: 'Bob', parentHashes: ['a1'], timestamp: '2023-09-02T12:00:00Z' },
                { hash: 'c3', message: 'Add licence', author: 'Carol', parentHashes: ['b2'], timestamp: '2023-09-03T12:00:00Z' },
                { hash: 'd4', message: 'Wire up CI', author: 'Dan', parentHashes: ['c3'], refs: ['main'], tags: ['v1.0.0'], isHead: true, timestamp: '2023-09-04T12:00:00Z' }
            ),
            [new Branch('main', 'local', 'd4', true)]
        ),
};

const singleMerge: Topology = {
    id: 'single-merge',
    label: 'One branch, one merge',
    exercises: 'A branch leaving lane 0 and rejoining it.',
    build: () =>
        repository(
            commits(
                { hash: 'a1', message: 'Initial commit', author: 'Alice', timestamp: '2023-09-01T09:00:00Z' },
                { hash: 'b2', message: 'Add README', author: 'Bob', parentHashes: ['a1'], timestamp: '2023-09-02T12:00:00Z' },
                { hash: 'c3', message: 'Start feature', author: 'Carol', parentHashes: ['b2'], timestamp: '2023-09-03T18:45:00Z' },
                { hash: 'c4', message: 'Finish feature', author: 'Carol', parentHashes: ['c3'], refs: ['feature'], timestamp: '2023-09-04T09:00:00Z' },
                { hash: 'd5', message: 'Merge branch feature into main', author: 'Dan', parentHashes: ['b2', 'c4'], refs: ['main'], remotes: ['origin/main'], isHead: true, timestamp: '2023-09-05T10:00:00Z' }
            ),
            [
                new Branch('main', 'local', 'd5', true),
                new Branch('feature', 'local', 'c4'),
            ]
        ),
};

const nestedBranches: Topology = {
    id: 'nested-branches',
    label: 'Five branches, nested merges',
    exercises:
        'Branches cut from other branches, a branch merged into a branch, and long-running lanes carried across many rows.',
    build: () =>
        repository(
            commits(
                { hash: 'm13', message: 'Merge branch feature5 into main', author: 'Zara', parentHashes: ['m12', 'f20'], refs: ['main'], remotes: ['origin/main'], tags: ['v2.0.0'], isHead: true, timestamp: '2023-09-20T10:00:00Z' },
                { hash: 'm12', message: 'Merge branch feature3 into main', author: 'Zane', parentHashes: ['m10', 'f12'], timestamp: '2023-09-18T10:00:00Z' },
                { hash: 'm10', message: 'Merge branch feature2 into main', author: 'Zoe', parentHashes: ['m9', 'f8'], timestamp: '2023-09-15T10:00:00Z' },
                { hash: 'm9', message: 'Merge branch feature1 into main', author: 'Yara', parentHashes: ['m7', 'f6'], timestamp: '2023-09-14T18:00:00Z' },
                { hash: 'm7', message: 'Mainline work', author: 'Xander', parentHashes: ['m5'], timestamp: '2023-09-13T12:00:00Z' },
                { hash: 'm5', message: 'Mainline work', author: 'Will', parentHashes: ['e5'], timestamp: '2023-09-12T09:00:00Z' },
                { hash: 'e5', message: 'Merge branch feature into main', author: 'Eve', parentHashes: ['d4', 'c3'], timestamp: '2023-09-05T10:30:00Z' },
                { hash: 'd4', message: 'Continue main', author: 'Dan', parentHashes: ['b2'], timestamp: '2023-09-04T15:00:00Z' },
                { hash: 'c3', message: 'Start feature', author: 'Carol', parentHashes: ['b2'], refs: ['feature'], timestamp: '2023-09-03T18:45:00Z' },
                { hash: 'b2', message: 'Add README', author: 'Bob', parentHashes: ['a1'], timestamp: '2023-09-02T12:00:00Z' },
                { hash: 'a1', message: 'Initial commit', author: 'Alice', timestamp: '2023-09-01T09:00:00Z' },

                { hash: 'f6', message: 'Finish feature1', author: 'Fay', parentHashes: ['f4'], refs: ['feature1'], timestamp: '2023-09-14T10:00:00Z' },
                { hash: 'f4', message: 'Work on feature1', author: 'Finn', parentHashes: ['d4'], timestamp: '2023-09-13T08:00:00Z' },

                { hash: 'f8', message: 'Finish feature2', author: 'Fern', parentHashes: ['f7'], refs: ['feature2'], timestamp: '2023-09-15T08:00:00Z' },
                { hash: 'f7', message: 'Work on feature2', author: 'Fritz', parentHashes: ['m5'], timestamp: '2023-09-14T20:00:00Z' },

                { hash: 'f12', message: 'Merge branch feature4 into feature3', author: 'Felix', parentHashes: ['f11', 'f14'], refs: ['feature3'], timestamp: '2023-09-17T18:00:00Z' },
                { hash: 'f11', message: 'Work on feature3', author: 'Fiona', parentHashes: ['f8'], timestamp: '2023-09-17T10:00:00Z' },

                { hash: 'f14', message: 'Finish feature4', author: 'Frank', parentHashes: ['f13'], refs: ['feature4'], timestamp: '2023-09-17T16:00:00Z' },
                { hash: 'f13', message: 'Work on feature4', author: 'Faith', parentHashes: ['f6'], timestamp: '2023-09-17T12:00:00Z' },

                { hash: 'f20', message: 'Finish feature5', author: 'Ferdinand', parentHashes: ['f19'], refs: ['feature5'], timestamp: '2023-09-19T16:00:00Z' },
                { hash: 'f19', message: 'Work on feature5', author: 'Fae', parentHashes: ['f12'], timestamp: '2023-09-19T12:00:00Z' }
            ),
            [
                new Branch('main', 'local', 'm13', true),
                new Branch('feature', 'local', 'c3'),
                new Branch('feature1', 'local', 'f6'),
                new Branch('feature2', 'local', 'f8'),
                new Branch('feature3', 'local', 'f12'),
                new Branch('feature4', 'local', 'f14'),
                new Branch('feature5', 'local', 'f20'),
                new Branch('origin/main', 'remote', 'm13'),
            ]
        ),
};

export const topologies: Topology[] = [linear, singleMerge, nestedBranches];

export const defaultTopology = nestedBranches;

export function topologyById(id: string): Topology | undefined {
    return topologies.find((t) => t.id === id);
}
