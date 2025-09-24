import { Commit } from "./commit.js";

export type GraphNode = {
    hash: string;
    row: number;
    lane: number;
}

export type GraphEdge = {
    row: number;
    fromLane: number;
    toLane: number;
}

export type GitGraph = {
    commits: Commit[];
    nodes: GraphNode[];
    edges: GraphEdge[];
}