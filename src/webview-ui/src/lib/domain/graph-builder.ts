import { Commit } from "./commit.js";
import { GitGraph, GraphEdge, GraphNode } from "./git-graph.js";

type GraphLanes = Map<string, number>;

export class GraphBuilder {
    commitsById: Map<string, Commit>;
    sortedCommitsNewestToOldest: Commit[];
    graphLanes: GraphLanes;
    nodes: GraphNode[];
    edges: GraphEdge[];

    constructor(commits: Commit[]) {
        this.sortedCommitsNewestToOldest = [...commits].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        this.commitsById = new Map<string, Commit>();
        this.sortedCommitsNewestToOldest.forEach(c => this.commitsById.set(c.hash, c));

        this.graphLanes = new Map<string, number>();
        this.nodes = [];
        this.edges = [];
    }

    buildGraph(): GitGraph {
        this.buildGraphLanes();

        this.nodes = [...this.sortedCommitsNewestToOldest].reverse().map((commit, index) => ({ hash: commit.hash, row: index, lane: this.graphLanes.get(commit.hash) as number }));

        this.buildEdges();

        return {
            commits: this.sortedCommitsNewestToOldest,
            nodes: this.nodes,
            edges: this.edges,
        };
    }

    private buildGraphLanes(): void {
        let nextLane = 0;

        const mainTip = this.sortedCommitsNewestToOldest.find(c => c.refs.includes('main'));

        if (mainTip) {
            this.graphLanes.set(mainTip.hash, nextLane++);
            this.markFirstParentsPathInLane(mainTip);
        }

        this.sortedCommitsNewestToOldest.forEach(commit => {
            if (!this.graphLanes.has(commit.hash)) {
                this.graphLanes.set(commit.hash, nextLane++);
                this.markFirstParentsPathInLane(commit);
            }
        });
    }

    private markFirstParentsPathInLane(commit: Commit): void {
        let currentCommit: Commit | undefined = commit;

        while (currentCommit) {
            const currentCommitLane = this.graphLanes.get(currentCommit.hash) as number;

            const firstParentHash = currentCommit.parentHashes?.[0];

            if (firstParentHash && !this.graphLanes.has(firstParentHash)) {
                this.graphLanes.set(firstParentHash, currentCommitLane);
            }

            currentCommit = this.commitsById.get(firstParentHash);
        }
    }

    private buildEdges(): void {
        const edges: GraphEdge[] = [];

        this.sortedCommitsNewestToOldest.forEach((commit) => {
            const edgesFromCommitToAllParents: GraphEdge[] = [];
            commit.parentHashes.forEach(parentHash => {
                const edgesFromCommitToParent: GraphEdge[] = [];
                const parent = this.commitsById.get(parentHash);
                if (parent) {
                    const fromLane = this.graphLanes.get(parent.hash) as number;
                    const parentRow = this.nodes.find(c => c.hash === parent.hash)?.row as number;
                    const currentCommitLane = this.graphLanes.get(commit.hash) as number;
                    const toLane = currentCommitLane;
                    edges.push({ row: parentRow, fromLane, toLane });

                    const currentCommitRow = this.nodes.find(c => c.hash === commit.hash)?.row as number;

                    for (let r = parentRow + 1; r < currentCommitRow; r++) {
                        edges.push({ row: r, fromLane: currentCommitLane, toLane });
                    }
                }
                edgesFromCommitToAllParents.push(...edgesFromCommitToParent);
            });
            edges.push(...edgesFromCommitToAllParents);
        });

        this.edges = edges;
    }
}