// Mock data for a small git repo with a branch and a merge
// Commits with ISO date strings, sorted newest to oldest
export const mockCommits = [
    //   // main merges feature5 (from feature3)
    //   { hash: 'm13', message: 'Merge branch feature5 into main', author: 'Zara', parentHashes: ['m12', 'f20'], refs: ['main'], date: '2023-09-20T10:00:00Z' },

    //   // main merges feature3 (which previously merged feature4)
    //   { hash: 'm12', message: 'Merge branch feature3 into main', author: 'Zane', parentHashes: ['m10', 'f12'], refs: [], date: '2023-09-18T10:00:00Z' },

    //   // main merges feature2
    //   { hash: 'm10', message: 'Merge branch feature2 into main', author: 'Zoe', parentHashes: ['m9', 'f8'], refs: [], date: '2023-09-15T10:00:00Z' },

    //   // main merges feature1
    //   { hash: 'm9',  message: 'Merge branch feature1 into main', author: 'Yara', parentHashes: ['m7', 'f6'], refs: [], date: '2023-09-14T18:00:00Z' },

    //   // mainline work
    //   { hash: 'm7',  message: 'Mainline work', author: 'Xander', parentHashes: ['m5'], refs: [], date: '2023-09-13T12:00:00Z' },
    //   { hash: 'm5',  message: 'Mainline work', author: 'Will',   parentHashes: ['e5'], refs: [], date: '2023-09-12T09:00:00Z' },

    //   // early merge: main merges "feature" (c3)
    //   { hash: 'e5',  message: 'Merge branch feature into main', author: 'Eve', parentHashes: ['d4', 'c3'], refs: [], date: '2023-09-05T10:30:00Z' },

    //   // pre-feature main commits
    //   { hash: 'd4',  message: 'Continue main', author: 'Dan',   parentHashes: ['b2'], refs: [], date: '2023-09-04T15:00:00Z' },

    //   // an early feature that got merged at e5
    //   { hash: 'c3',  message: 'Start feature', author: 'Carol', parentHashes: ['b2'], refs: ['feature'], date: '2023-09-03T18:45:00Z' },

    //   // main history roots
    //   { hash: 'b2',  message: 'Add README',     author: 'Bob',   parentHashes: ['a1'], refs: [], date: '2023-09-02T12:00:00Z' },
    //   { hash: 'a1',  message: 'Initial commit', author: 'Alice', parentHashes: [],     refs: [], date: '2023-09-01T09:00:00Z' },

    //   // ----------------- feature1 (from d4) -> merge at m9 -----------------
    //   { hash: 'f6',  message: 'Finish feature1', author: 'Fay',  parentHashes: ['f4'], refs: ['feature1'], date: '2023-09-14T10:00:00Z' },
    //   { hash: 'f4',  message: 'Work on feature1', author: 'Finn', parentHashes: ['d4'], refs: [],           date: '2023-09-13T08:00:00Z' },

    //   // ----------------- feature2 (from m5) -> merge at m10 ----------------
    //   { hash: 'f8',  message: 'Finish feature2', author: 'Fern',  parentHashes: ['f7'], refs: ['feature2'], date: '2023-09-15T08:00:00Z' },
    //   { hash: 'f7',  message: 'Work on feature2', author: 'Fritz', parentHashes: ['m5'], refs: [],          date: '2023-09-14T20:00:00Z' },

    //   // ----------------- feature3 (from feature2) -> merge at m12 ----------
    //   // feature3 also merges feature4 before going into main
    //   { hash: 'f12', message: 'Merge branch feature4 into feature3', author: 'Felix',  parentHashes: ['f11', 'f14'], refs: ['feature3'], date: '2023-09-17T18:00:00Z' },
    //   { hash: 'f11', message: 'Work on feature3',                    author: 'Fiona',  parentHashes: ['f8'],          refs: [],          date: '2023-09-17T10:00:00Z' },

    //   // ----------------- feature4 (from feature1) -> merge into feature3 ---
    //   { hash: 'f14', message: 'Finish feature4', author: 'Frank',  parentHashes: ['f13'], refs: ['feature4'], date: '2023-09-17T16:00:00Z' },
    //   { hash: 'f13', message: 'Work on feature4', author: 'Faith', parentHashes: ['f6'],  refs: [],           date: '2023-09-17T12:00:00Z' },

    //   // ----------------- feature5 (from feature3) -> merge at m13 ----------
    //   { hash: 'f20', message: 'Finish feature5', author: 'Ferdinand', parentHashes: ['f19'], refs: ['feature5'], date: '2023-09-19T16:00:00Z' },
    //   { hash: 'f19', message: 'Work on feature5', author: 'Fae',       parentHashes: ['f12'], refs: [],           date: '2023-09-19T12:00:00Z' },

    { hash: 'a1', parentHashes: [], refs: [], message: 'Initial commit', timestamp: new Date('2023-01-01T10:00:00Z').toISOString() },
    { hash: 'b2', parentHashes: ['a1'], refs: [], message: 'Second commit', timestamp: new Date('2023-01-02T10:00:00Z').toISOString() },
    { hash: 'c3', parentHashes: ['a1'], refs: [], message: 'Feature commit 1', timestamp: new Date('2023-01-03T10:00:00Z').toISOString() },
    { hash: 'c4', parentHashes: ['c3'], refs: ['feature'], message: 'Feature commit 2', timestamp: new Date('2023-01-04T10:00:00Z').toISOString() },
    { hash: 'd4', parentHashes: ['b2', 'c4'], refs: ['main'], message: 'Merge feature into main', timestamp: new Date('2023-01-05T10:00:00Z').toISOString() },
    { hash: 'e5', parentHashes: ['d4'], refs: [], message: 'Dangling commit', timestamp: new Date('2023-01-06T10:00:00Z').toISOString() }
];