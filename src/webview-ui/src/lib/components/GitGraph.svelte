<script lang="ts">
    import { GraphBuilder } from "../domain/graph-builder.js";
    import type { Commit } from "../domain/commit.js";
    import type { GraphNode, GraphEdge } from "../domain/git-graph.js";

    // Input: newest-first commit list
    export let commits: Array<{
        id?: string;
        hash?: string;
        parents: string[];
        refs?: string[];
        branchHint?: string;
        message?: string;
        author?: string;
        date?: string;
        [k: string]: any;
    }> = [];

    export let colW = 24; // px per lane
    export let rowH = 36; // px per row

    let nodes: GraphNode[] = [];
    let segments: GraphEdge[] = [];
    let maxLane = 0;

    // Helper to normalize commit ID
    const idOf = (c: { id?: string; hash?: string }) => (c.id ?? c.hash)!;

    // Convert input commits to domain model
    function convertToDomainCommits(inputCommits: typeof commits): Commit[] {
        return inputCommits.map((c) => ({
            hash: idOf(c),
            parentHashes: c.parents || [],
            refs: c.refs || [],
            message: c.message || "",
            timestamp: c.date || new Date().toISOString(),
        }));
    }

    $: {
        nodes = [];
        segments = [];
        maxLane = 0;

        if (commits.length) {
            const graphBuilder = new GraphBuilder(commits);
            const domainCommits = convertToDomainCommits(commits);
            const graph = graphBuilder.buildGraph();

            nodes = graph.nodes;
            segments = graph.edges;
            maxLane = Math.max(0, ...nodes.map((n) => n.lane));
        }
    }

    // Geometry helpers
    function xy(lane: number, row: number) {
        return [lane * colW + colW / 2, row * rowH + rowH / 2] as const;
    }

    function segmentPath(seg: GraphEdge) {
        const [x0, y0] = xy(seg.fromLane, seg.row);
        const [x1, y1] = xy(seg.toLane, seg.row + 1);
        if (seg.fromLane === seg.toLane) return `M ${x0} ${y0} L ${x1} ${y1}`; // vertical carry
        const c1y = y0 + rowH * 0.4,
            c2y = y1 - rowH * 0.4;
        return `M ${x0} ${y0} C ${x0} ${c1y}, ${x1} ${c2y}, ${x1} ${y1}`;
    }

    function laneColor(lane: number) {
        const colors = [
            "#3b82f6",
            "#10b981",
            "#f59e42",
            "#e11d48",
            "#a21caf",
            "#fbbf24",
            "#6366f1",
            "#14b8a6",
        ];
        return colors[lane % colors.length];
    }
</script>

<div
    style="position:relative; width:100%; min-width:180px; height:{commits.length *
        rowH}px;"
>
    <svg
        style="position:absolute; inset:0; width:100%; height:100%; pointer-events:none;"
    >
        {#each segments as seg}
            <path
                d={segmentPath(seg)}
                stroke={laneColor(seg.fromLane)}
                stroke-width="2"
                fill="none"
                opacity="0.9"
            />
        {/each}
        {#each nodes as node}
            <circle
                cx={xy(node.lane, node.row)[0]}
                cy={xy(node.lane, node.row)[1]}
                r="7"
                fill={laneColor(node.lane)}
                stroke="#222"
                stroke-width="2"
            />
        {/each}
    </svg>

    <div id="rows" style="position:relative; z-index:1;">
        {#each commits as commit, row}
            <div class="flex items-center" style="height:{rowH}px;">
                <div
                    style="width:{(maxLane + 1) * colW}px; min-width:60px;"
                ></div>
                <div class="flex-1 pl-2">
                    <slot name="row" {commit} {row}></slot>
                </div>
            </div>
        {/each}
    </div>
</div>

<style>
    #rows {
        width: 100%;
    }
</style>
