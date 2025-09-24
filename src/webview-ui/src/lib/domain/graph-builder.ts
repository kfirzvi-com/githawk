import { Commit } from "./commit.js";
import { GitGraph, GraphEdge } from "./git-graph.js";

export class GraphBuilder {
    buildGraph(commits: Commit[]): GitGraph {
        let branchesLanes = new Map<string, number>();
        let nextLane = 0;

        branchesLanes.set('main', nextLane++);

        commits.forEach(c => c.refs.forEach(ref => {
            if (!branchesLanes.has(ref)) {
                branchesLanes.set(ref, nextLane++);
            }
        }));

        const nodes = commits.map((commit, index) => ({ hash: commit.hash, row: index, lane: branchesLanes.get(commit.refs[0] || 'main') || 0 }));

        const edges: GraphEdge[] = [];

        commits.forEach((commit, index) => {
            const edgesFromCommitToAllParents: GraphEdge[] = [];
            commit.parentHashes.forEach(parentHash => {
                const edgesFromCommitToParent: GraphEdge[] = [];
                const parentIndex = nodes.find(c => c.hash === parentHash)?.row || 0;
                if (parentIndex !== -1) {
                    const fromLane = branchesLanes.get(commits[parentIndex].refs[0] || 'main') || 0;
                    const parentRow = parentIndex;
                    const currentCommitLane = branchesLanes.get(commit.refs[0] || 'main') || 0;
                    const toLane = currentCommitLane;
                    edges.push({ row: parentIndex, fromLane, toLane });

                    const currentCommitRow = nodes.find(c => c.hash === commit.hash)?.row || 0;

                    for (let r = parentRow + 1; r < currentCommitRow; r++) {
                        edges.push({ row: r, fromLane: currentCommitLane, toLane });
                    }
                }
                edgesFromCommitToAllParents.push(...edgesFromCommitToParent);
            });
            edges.push(...edgesFromCommitToAllParents);
        });

        return {
            commits,
            nodes,
            edges,
        } as GitGraph;
    }
}