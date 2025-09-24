// Mock data for a small git repo with a branch and a merge
// Commits with ISO date strings, sorted newest to oldest
export const mockCommits = [
  // main merges feature3, feature2, and feature1
  { hash: 'm13', message: 'Merge branch feature5 into main', author: 'Zara', parents: ['m12', 'f20'], refs: [], branchHint: 'main', date: '2023-09-20T10:00:00Z' },
  { hash: 'm12', message: 'Merge branch feature3 into main', author: 'Zane', parents: ['m10', 'f12'], refs: [], branchHint: 'main', date: '2023-09-18T10:00:00Z' },
  { hash: 'm10', message: 'Merge branch feature2 into main', author: 'Zoe', parents: ['m9', 'f8'], refs: [], branchHint: 'main', date: '2023-09-15T10:00:00Z' },
  { hash: 'm9', message: 'Merge branch feature1 into main', author: 'Yara', parents: ['m7', 'f6'], refs: [], branchHint: 'main', date: '2023-09-14T18:00:00Z' },
  { hash: 'm7', message: 'Mainline work', author: 'Xander', parents: ['m5'], refs: [], branchHint: 'main', date: '2023-09-13T12:00:00Z' },
  { hash: 'm5', message: 'Mainline work', author: 'Will', parents: ['e5'], refs: [], branchHint: 'main', date: '2023-09-12T09:00:00Z' },
  { hash: 'e5', message: 'Merge branch feature into main', author: 'Eve', parents: ['d4', 'c3'], refs: [], branchHint: 'main', date: '2023-09-05T10:30:00Z' },
  { hash: 'd4', message: 'Continue main', author: 'Dan', parents: ['b2'], refs: [], branchHint: 'main', date: '2023-09-04T15:00:00Z' },
  { hash: 'c3', message: 'Start feature', author: 'Carol', parents: ['b2'], refs: ['feature'], branchHint: 'feature', date: '2023-09-03T18:45:00Z' },
  { hash: 'b2', message: 'Add README', author: 'Bob', parents: ['a1'], refs: [], branchHint: 'main', date: '2023-09-02T12:00:00Z' },
  { hash: 'a1', message: 'Initial commit', author: 'Alice', parents: [], refs: ['main'], branchHint: 'main', date: '2023-09-01T09:00:00Z' },

  // feature1 branch from d4, merges into main at m9
  { hash: 'f6', message: 'Finish feature1', author: 'Fay', parents: ['f4'], refs: ['feature1'], branchHint: 'feature1', date: '2023-09-14T10:00:00Z' },
  { hash: 'f4', message: 'Work on feature1', author: 'Finn', parents: ['d4'], refs: [], branchHint: 'feature1', date: '2023-09-13T08:00:00Z' },

  // feature2 branch from m5, merges into main at m10
  { hash: 'f8', message: 'Finish feature2', author: 'Fern', parents: ['f7'], refs: ['feature2'], branchHint: 'feature2', date: '2023-09-15T08:00:00Z' },
  { hash: 'f7', message: 'Work on feature2', author: 'Fritz', parents: ['m5'], refs: [], branchHint: 'feature2', date: '2023-09-14T20:00:00Z' },

  // feature3 branches from feature2, merges into main at m12
  { hash: 'f12', message: 'Merge branch feature4 into feature3', author: 'Felix', parents: ['f11', 'f14'], refs: ['feature3'], branchHint: 'feature3', date: '2023-09-17T18:00:00Z' },
  { hash: 'f11', message: 'Work on feature3', author: 'Fiona', parents: ['f8'], refs: [], branchHint: 'feature3', date: '2023-09-17T10:00:00Z' },

  // feature4 branches from feature1, merges into feature3 at f12
  { hash: 'f14', message: 'Finish feature4', author: 'Frank', parents: ['f13'], refs: ['feature4'], branchHint: 'feature4', date: '2023-09-17T16:00:00Z' },
  { hash: 'f13', message: 'Work on feature4', author: 'Faith', parents: ['f6'], refs: [], branchHint: 'feature4', date: '2023-09-17T12:00:00Z' },

  // feature5 branches from feature3, merges into main at m13
  { hash: 'f20', message: 'Finish feature5', author: 'Ferdinand', parents: ['f19'], refs: ['feature5'], branchHint: 'feature5', date: '2023-09-19T16:00:00Z' },
  { hash: 'f19', message: 'Work on feature5', author: 'Fae', parents: ['f12'], refs: [], branchHint: 'feature5', date: '2023-09-19T12:00:00Z' },
];

export const mockBranches = [
  { name: 'main', type: 'local', current: true, commit: 'e5' },
  { name: 'feature', type: 'local', current: false, commit: 'c3' }
];

// Minimal graphRows for each commit (for demo)
export const mockGraphRows = [
  { commitX: 20, commitColor: '#3b82f6', branchLines: [], connectionLines: [] },
  { commitX: 20, commitColor: '#3b82f6', branchLines: [], connectionLines: [] },
  { commitX: 44, commitColor: '#10b981', branchLines: [], connectionLines: [{ startX: 20, endX: 44, color: '#10b981' }] },
  { commitX: 20, commitColor: '#3b82f6', branchLines: [], connectionLines: [] },
  { commitX: 20, commitColor: '#3b82f6', branchLines: [{ x: 44, color: '#10b981' }], connectionLines: [{ startX: 44, endX: 20, color: '#10b981' }] }
];
