import type { GraphEdge } from '../../../domain/models/GitGraph';

/**
 * The only place row/lane coordinates become pixels. Keeping this out of the
 * domain is what lets the layout algorithm be tested without a renderer.
 */
export interface GraphMetrics {
    /** Horizontal distance between lanes, in px. */
    colW: number;
    /** Vertical distance between rows, in px. */
    rowH: number;
    /** Commit dot radius, in px. */
    dotRadius: number;
}

export const defaultMetrics: GraphMetrics = {
    colW: 28,
    rowH: 40,
    dotRadius: 7,
};

export interface Point {
    x: number;
    y: number;
}

export function nodeCenter(lane: number, row: number, m: GraphMetrics): Point {
    return {
        x: lane * m.colW + m.colW / 2,
        y: row * m.rowH + m.rowH / 2,
    };
}

/** Total width needed to draw every lane up to and including `maxLane`. */
export function graphWidth(maxLane: number, m: GraphMetrics): number {
    return (maxLane + 1) * m.colW;
}

export function graphHeight(rowCount: number, m: GraphMetrics): number {
    return rowCount * m.rowH;
}

/**
 * An SVG path for one segment. Segments travel from their own row towards the
 * newer commit one row above, so a lane change becomes a bezier and a straight
 * carry becomes a line.
 */
export function edgePath(edge: GraphEdge, m: GraphMetrics): string {
    const from = nodeCenter(edge.fromLane, edge.row, m);
    const to = nodeCenter(edge.toLane, edge.row - 1, m);

    if (edge.fromLane === edge.toLane) {
        return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }

    const control1Y = from.y - m.rowH * 0.4;
    const control2Y = to.y + m.rowH * 0.4;
    return `M ${from.x} ${from.y} C ${from.x} ${control1Y}, ${to.x} ${control2Y}, ${to.x} ${to.y}`;
}

const LANE_COLORS = [
    '#3b82f6',
    '#10b981',
    '#f59e42',
    '#e11d48',
    '#a21caf',
    '#fbbf24',
    '#6366f1',
    '#14b8a6',
] as const;

export function laneColor(lane: number): string {
    return LANE_COLORS[lane % LANE_COLORS.length];
}
