import { Commit } from './Commit';

/** A commit's position in the rendered graph. Rows and lanes, never pixels. */
export interface GraphNode {
    hash: string;
    row: number;
    lane: number;
}

/**
 * A one-row line segment. `row` is the row the segment starts on; it travels
 * one row towards the newer commit, moving from `fromLane` to `toLane`.
 */
export interface GraphEdge {
    row: number;
    fromLane: number;
    toLane: number;
}

/** Commits in render order (newest first) plus their computed topology. */
export interface GitGraph {
    commits: Commit[];
    nodes: GraphNode[];
    edges: GraphEdge[];
}
