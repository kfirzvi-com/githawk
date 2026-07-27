import { Commit } from '../models/Commit';
import { GitGraph, GraphEdge, GraphNode } from '../models/GitGraph';
import { orderTopologically } from './commitOrdering';

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
 *
 * Lanes come from a single downward sweep that tracks, per lane, the commit that
 * lane is still waiting to reach. A lane is released the moment it delivers, and
 * a new branch takes the lowest free lane — so the lane count tracks how many
 * branches are open *at the same row*, not how many the repository has ever had.
 * Allocating monotonically instead made a 49-branch repository 23 lanes wide and
 * pushed every commit message off screen.
 */
export class GraphLayoutService {
    layout(commits: Commit[], options: LayoutOptions = {}): GitGraph {
        const ordered = orderTopologically(commits);
        const byHash = new Map(ordered.map((c) => [c.hash, c]));

        const primaryChain = this.primaryFirstParentChain(
            ordered,
            byHash,
            options.primaryBranchName
        );

        const { nodes, carryLanes } = this.sweepLanes(
            ordered,
            byHash,
            primaryChain
        );
        const edges = this.buildEdges(ordered, byHash, nodes, carryLanes);

        return { commits: ordered, nodes, edges };
    }

    /**
     * The primary branch's first-parent path. These commits own lane 0
     * exclusively, which is what makes the mainline read as one straight spine
     * rather than drifting sideways as side branches come and go.
     */
    private primaryFirstParentChain(
        ordered: Commit[],
        byHash: Map<string, Commit>,
        primaryBranchName?: string
    ): Set<string> {
        const chain = new Set<string>();
        let current = this.findPrimaryTip(ordered, primaryBranchName);

        while (current && !chain.has(current.hash)) {
            chain.add(current.hash);
            const firstParent = current.primaryParentHash;
            current = firstParent ? byHash.get(firstParent) : undefined;
        }

        return chain;
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

    /**
     * One pass down the rows. `pending[lane]` holds the hash that lane is waiting
     * to reach; `null` means the lane is free and may be reused immediately.
     */
    private sweepLanes(
        ordered: Commit[],
        byHash: Map<string, Commit>,
        primaryChain: Set<string>
    ): { nodes: GraphNode[]; carryLanes: Map<string, number> } {
        const pending: (string | null)[] = [];
        const nodes: GraphNode[] = [];
        /** `child->parent` to the lane carrying that connection between them. */
        const carryLanes = new Map<string, number>();

        // Lane 0 is reserved for the spine whenever there is one, so a side
        // branch can never squat in it and force the mainline sideways.
        const firstFreeForBranches = primaryChain.size > 0 ? 1 : 0;

        const ensureLane = (lane: number): void => {
            while (pending.length <= lane) {
                pending.push(null);
            }
        };

        const allocate = (): number => {
            for (let lane = firstFreeForBranches; lane < pending.length; lane++) {
                if (pending[lane] === null) {
                    return lane;
                }
            }
            // Growing must still respect the reservation: appending to an empty
            // array would otherwise hand out lane 0 and displace the spine.
            const lane = Math.max(pending.length, firstFreeForBranches);
            ensureLane(lane);
            return lane;
        };

        ordered.forEach((commit, row) => {
            const arriving: number[] = [];
            for (let lane = 0; lane < pending.length; lane++) {
                if (pending[lane] === commit.hash) {
                    arriving.push(lane);
                }
            }

            let lane: number;
            if (primaryChain.has(commit.hash)) {
                lane = 0;
            } else if (arriving.length > 0) {
                // Prefer the leftmost lane already heading here; the others
                // converge into it and are released.
                lane = arriving[0];
            } else {
                lane = allocate();
            }
            ensureLane(lane);

            // Every lane that was waiting for this commit has now delivered.
            for (const delivered of arriving) {
                pending[delivered] = null;
            }
            pending[lane] = null;

            nodes.push({ hash: commit.hash, row, lane });

            commit.parentHashes.forEach((parentHash, index) => {
                if (!byHash.has(parentHash)) {
                    // Parent lies outside the loaded window: nothing to carry.
                    return;
                }

                let carry: number;
                if (index === 0) {
                    // The first parent continues straight down this lane.
                    carry = lane;
                } else {
                    // A merged-in branch reuses a lane already heading for that
                    // parent, otherwise takes the lowest free one.
                    const existing = pending.indexOf(parentHash);
                    carry = existing >= 0 ? existing : allocate();
                }

                ensureLane(carry);
                pending[carry] = parentHash;
                carryLanes.set(edgeKey(commit.hash, parentHash), carry);
            });
        });

        return { nodes, carryLanes };
    }

    /**
     * Exactly one segment per row-gap per connection, so a line is continuous
     * and never doubled. Gap `k` spans row `k` (older, below) up to row `k - 1`.
     */
    private buildEdges(
        ordered: Commit[],
        byHash: Map<string, Commit>,
        nodes: GraphNode[],
        carryLanes: Map<string, number>
    ): GraphEdge[] {
        const rowOf = new Map(nodes.map((n) => [n.hash, n.row]));
        const laneOf = new Map(nodes.map((n) => [n.hash, n.lane]));
        const edges: GraphEdge[] = [];

        for (const commit of ordered) {
            const childRow = rowOf.get(commit.hash) ?? 0;
            const childLane = laneOf.get(commit.hash) ?? 0;

            for (const parentHash of commit.parentHashes) {
                if (!byHash.has(parentHash)) {
                    continue;
                }

                const parentRow = rowOf.get(parentHash) ?? 0;
                const parentLane = laneOf.get(parentHash) ?? 0;
                const carryLane =
                    carryLanes.get(edgeKey(commit.hash, parentHash)) ?? childLane;

                if (parentRow <= childRow) {
                    // Topological ordering rules this out; skipping beats
                    // emitting a segment that would draw upside down.
                    continue;
                }

                if (parentRow === childRow + 1) {
                    edges.push({
                        row: parentRow,
                        fromLane: parentLane,
                        toLane: childLane,
                    });
                    continue;
                }

                // Leaving the parent, joining the carry lane.
                edges.push({
                    row: parentRow,
                    fromLane: parentLane,
                    toLane: carryLane,
                });

                // Straight run down the carry lane.
                for (let row = parentRow - 1; row > childRow + 1; row--) {
                    edges.push({ row, fromLane: carryLane, toLane: carryLane });
                }

                // Final gap, arriving at the child.
                edges.push({
                    row: childRow + 1,
                    fromLane: carryLane,
                    toLane: childLane,
                });
            }
        }

        return edges;
    }
}

function edgeKey(childHash: string, parentHash: string): string {
    return `${childHash}->${parentHash}`;
}
