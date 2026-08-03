<script lang="ts">
    import type { Snippet } from 'svelte';
    import type { Commit } from '../../../domain/models/Commit';
    import type { GitGraph } from '../../../domain/models/GitGraph';
    import {
        defaultMetrics,
        edgePath,
        graphHeight,
        graphWidth,
        laneColor,
        nodeCenter,
        type GraphMetrics,
    } from '../viewmodels/graphGeometry';
    import type { SelectModifiers } from '../viewmodels/selection';

    interface Props {
        /** Pre-computed topology. This component renders; it does not lay out. */
        graph: GitGraph;
        metrics?: GraphMetrics;
        selectedHash?: string | null;
        /** Additional hashes highlighted as part of a multi-selection. */
        comparedHashes?: ReadonlySet<string>;
        row: Snippet<[Commit, number]>;
        onSelect?: (commit: Commit, modifiers: SelectModifiers) => void;
        onContextMenu?: (commit: Commit) => void;
    }

    let {
        graph,
        metrics = defaultMetrics,
        selectedHash = null,
        comparedHashes = new Set<string>(),
        row,
        onSelect,
        onContextMenu,
    }: Props = $props();

    const maxLane = $derived(
        graph.nodes.reduce((max, node) => Math.max(max, node.lane), 0)
    );
    const gutterWidth = $derived(graphWidth(maxLane, metrics));
    const totalHeight = $derived(graphHeight(graph.commits.length, metrics));
</script>

<div
    class="relative w-full"
    style="min-width:180px; height:{totalHeight}px;"
    data-testid="git-graph"
>
    <svg
        class="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
    >
        <!-- Deliberately unkeyed: the layout can emit identical carry segments
             for two different commits, and duplicate keys are a hard error. -->
        {#each graph.edges as edge}
            <path
                d={edgePath(edge, metrics)}
                stroke={laneColor(edge.fromLane)}
                stroke-width="2"
                fill="none"
                opacity="0.9"
            />
        {/each}
        {#each graph.nodes as node (node.hash)}
            <circle
                class="commit-dot"
                cx={nodeCenter(node.lane, node.row, metrics).x}
                cy={nodeCenter(node.lane, node.row, metrics).y}
                r={metrics.dotRadius}
                fill={laneColor(node.lane)}
                stroke="var(--vscode-editor-background, #222)"
                stroke-width="2"
            />
        {/each}
    </svg>

    <div class="relative z-[1]">
        {#each graph.commits as commit, index (commit.hash)}
            <!--
                The row is a full-width click target, but it is painted only
                from the gutter's edge rightwards. The rows sit above the SVG,
                so a background on the button itself covers the lanes and dots
                the SVG drew underneath — a hovered row would erase that part
                of the graph. `group` is what lets the inner half react to a
                hover on the whole row.
            -->
            <button
                type="button"
                class="group flex w-full items-center text-left"
                style="height:{metrics.rowH}px;"
                onclick={(event) =>
                    onSelect?.(commit, {
                        // Cmd on macOS, Ctrl elsewhere.
                        toggle: event.metaKey || event.ctrlKey,
                        range: event.shiftKey,
                    })}
                oncontextmenu={(event) => {
                    // The native VS Code menu replaces the browser one.
                    event.preventDefault();
                    onSelect?.(commit, { toggle: false, range: false });
                    onContextMenu?.(commit);
                }}
            >
                <div style="width:{gutterWidth}px; min-width:60px;"></div>
                <div
                    class="flex min-w-0 flex-1 items-center self-stretch pl-2 group-hover:bg-hover {comparedHashes.has(
                        commit.hash
                    )
                        ? 'bg-warn/15 ring-1 ring-inset ring-warn/40'
                        : selectedHash === commit.hash
                          ? 'bg-selected'
                          : ''}"
                >
                    <div class="min-w-0 flex-1">
                        {@render row(commit, index)}
                    </div>
                </div>
            </button>
        {/each}
    </div>
</div>
