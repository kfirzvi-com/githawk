import { Commit } from '../models/Commit';
import { GitGraph, GraphEdge, GraphNode } from '../models/GitGraph';
import { orderTopologically } from './commitOrdering';

type LaneAssignment = Map<string, number>;

/**
 * Assigns each commit a row and a lane, and derives the line segments that
 * connect them.
 *
 * Stateless by design: every method takes what it needs and returns a value, so
 * a layout can be computed on the extension host or inside the webview with
 * identical results and no shared mutable state.
 *
 * Rows are newest-first (row 0 is the newest commit, at the top of the view),
 * ordered topologically so a parent is never placed above its child. See
 * commitOrdering.ts for why a date sort is not sufficient.
 */
export interface LayoutOptions {
    /**
     * Which branch should claim lane 0 and read as the spine. Supply the
     * repository's checked-out or default branch; a hardcoded 'main' leaves
     * every repository on 'master' or a custom default without a spine.
     */
    primaryBranchName?: string;
}

/** Tried in order when no primary branch is supplied. */
const FALLBACK_PRIMARY_BRANCHES = ['main', 'master', 'trunk', 'develop'];

export class GraphLayoutService {
    layout(commits: Commit[], options: LayoutOptions = {}): GitGraph {
        const ordered = this.orderNewestFirst(commits);
        const byHash = new Map(ordered.map((c) => [c.hash, c]));

        const lanes = this.assignLanes(ordered, byHash, options);

        const nodes: GraphNode[] = ordered.map((commit, row) => ({
            hash: commit.hash,
            row,
            lane: lanes.get(commit.hash) ?? 0,
        }));

        const rowByHash = new Map(nodes.map((n) => [n.hash, n.row]));
        const edges = this.buildEdges(ordered, byHash, lanes, rowByHash);

        return { commits: ordered, nodes, edges };
    }

    private orderNewestFirst(commits: Commit[]): Commit[] {
        return orderTopologically(commits);
    }

    /**
     * The primary branch tip claims lane 0 so the mainline reads as a straight
     * spine. Every other unclaimed commit opens the next free lane, and each
     * lane is then extended backwards along its first-parent path.
     */
    private assignLanes(
        ordered: Commit[],
        byHash: Map<string, Commit>,
        options: LayoutOptions
    ): LaneAssignment {
        const lanes: LaneAssignment = new Map();
        let nextLane = 0;

        const primaryTip = this.findPrimaryTip(ordered, options.primaryBranchName);
        if (primaryTip) {
            lanes.set(primaryTip.hash, nextLane++);
            this.extendLaneAlongFirstParents(primaryTip, lanes, byHash);
        }

        for (const commit of ordered) {
            if (!lanes.has(commit.hash)) {
                lanes.set(commit.hash, nextLane++);
                this.extendLaneAlongFirstParents(commit, lanes, byHash);
            }
        }

        return lanes;
    }

    /**
     * Falls back through the conventional default-branch names, then to the
     * newest commit — so an unnamed or detached history still gets a spine
     * rather than every commit opening its own lane.
     */
    private findPrimaryTip(
        ordered: Commit[],
        primaryBranchName?: string
    ): Commit | undefined {
        if (primaryBranchName) {
            const named = ordered.find((c) => c.hasBranch(primaryBranchName));
            if (named) {
                return named;
            }
        }

        for (const candidate of FALLBACK_PRIMARY_BRANCHES) {
            const match = ordered.find((c) => c.refs.includes(candidate));
            if (match) {
                return match;
            }
        }

        return ordered[0];
    }

    private extendLaneAlongFirstParents(
        start: Commit,
        lanes: LaneAssignment,
        byHash: Map<string, Commit>
    ): void {
        // `seen` only guards against malformed input; a git DAG cannot cycle.
        const seen = new Set<string>();
        let current: Commit | undefined = start;

        while (current && !seen.has(current.hash)) {
            seen.add(current.hash);

            const lane = lanes.get(current.hash) ?? 0;
            const firstParentHash = current.primaryParentHash;
            if (firstParentHash === undefined) {
                return;
            }

            if (!lanes.has(firstParentHash)) {
                lanes.set(firstParentHash, lane);
            }

            current = byHash.get(firstParentHash);
        }
    }

    /**
     * One segment per row between a commit and each of its parents: a joining
     * segment at the parent's row, plus vertical carries for every row in
     * between so the line is continuous down the view.
     */
    private buildEdges(
        ordered: Commit[],
        byHash: Map<string, Commit>,
        lanes: LaneAssignment,
        rowByHash: Map<string, number>
    ): GraphEdge[] {
        const edges: GraphEdge[] = [];

        for (const commit of ordered) {
            const commitLane = lanes.get(commit.hash) ?? 0;
            const commitRow = rowByHash.get(commit.hash) ?? 0;
            const joiningSegments: GraphEdge[] = [];

            for (const parentHash of commit.parentHashes) {
                const parent = byHash.get(parentHash);
                if (!parent) {
                    // Parent lies outside the loaded page of history.
                    continue;
                }

                const parentLane = lanes.get(parent.hash) ?? 0;
                const parentRow = rowByHash.get(parent.hash) ?? 0;

                joiningSegments.push({
                    row: parentRow,
                    fromLane: parentLane,
                    toLane: commitLane,
                });

                for (let row = parentRow - 1; row > commitRow; row--) {
                    edges.push({ row, fromLane: commitLane, toLane: commitLane });
                }
            }

            edges.push(...joiningSegments);
        }

        return edges;
    }
}
