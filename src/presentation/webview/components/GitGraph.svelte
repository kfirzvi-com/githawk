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
    import type { GraphKeyAction } from '../viewmodels/graphKeys';
    import { resolveGraphKey } from '../viewmodels/graphKeys';

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
        /**
         * The row the keyboard is on, which is not the same as the row that is
         * selected: the cursor moves freely and only Enter or Space commits to
         * anything. Null while the graph has never been focused.
         */
        cursorHash?: string | null;
        /** Space picks rather than clicks, and the rows say so. */
        selecting?: boolean;
        onGraphKey?: (action: GraphKeyAction, commit: Commit) => void;
        /**
         * The cursor is on a row that is not a commit — the uncommitted
         * changes above the graph — which then holds the one tabbable slot.
         * Two tab stops in one list would be two lists.
         */
        cursorAbove?: boolean;
    }

    let {
        graph,
        metrics = defaultMetrics,
        selectedHash = null,
        comparedHashes = new Set<string>(),
        row,
        onSelect,
        onContextMenu,
        cursorHash = null,
        selecting = false,
        onGraphKey,
        cursorAbove = false,
    }: Props = $props();

    const maxLane = $derived(
        graph.nodes.reduce((max, node) => Math.max(max, node.lane), 0)
    );
    const gutterWidth = $derived(graphWidth(maxLane, metrics));
    const totalHeight = $derived(graphHeight(graph.commits.length, metrics));

    /*
     * A roving tabindex, which is what a list of buttons is supposed to do:
     * exactly one row is reachable with Tab, and the arrows move between them
     * once you are inside. Leaving every row tabbable would make Tab walk five
     * hundred commits before it reached anything else on the page.
     *
     * The cursor row when there is one, otherwise the first, so that a Tab into
     * a graph nobody has touched yet lands somewhere sensible.
     */
    const tabbableHash = $derived(
        cursorAbove
            ? null
            : cursorHash &&
                graph.commits.some((commit) => commit.hash === cursorHash)
              ? cursorHash
              : (graph.commits[0]?.hash ?? null)
    );

    const handleKeyDown = (event: KeyboardEvent, commit: Commit) => {
        const action = resolveGraphKey(event, selecting);
        if (!action) {
            return;
        }

        /*
         * Only once something matched. An arrow the graph did not claim is the
         * scroller's, and Enter on a row the browser would have clicked anyway
         * still has to stop here — App runs the same handler the mouse does,
         * and letting the click through as well would run it twice.
         */
        event.preventDefault();
        onGraphKey?.(action, commit);
    };
</script>

<div
    class="relative w-full"
    style="min-width:180px; height:{totalHeight}px;"
    data-testid="git-graph"
    role="listbox"
    aria-multiselectable="true"
    aria-label="Commits"
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
                data-hash={commit.hash}
                role="option"
                tabindex={tabbableHash === commit.hash ? 0 : -1}
                aria-current={cursorHash === commit.hash ? 'true' : undefined}
                aria-selected={comparedHashes.has(commit.hash)}
                class="group flex w-full items-center text-left focus:outline-none"
                style="height:{metrics.rowH}px;"
                onkeydown={(event) => handleKeyDown(event, commit)}
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
                <!--
                    Three states that can all be true at once, drawn so they do
                    not fight: the fill says what is selected, the outline says
                    where the keyboard is. A ring rather than another fill,
                    because a cursor on an already-selected row has to still be
                    visible.
                -->
                <div
                    class="flex min-w-0 flex-1 items-center self-stretch pl-2 group-hover:bg-hover {comparedHashes.has(
                        commit.hash
                    )
                        ? 'bg-warn/15 ring-1 ring-inset ring-warn/40'
                        : selectedHash === commit.hash
                          ? 'bg-selected'
                          : ''} {cursorHash === commit.hash
                        ? 'outline-2 -outline-offset-2 outline-info-strong group-focus:outline'
                        : ''}"
                >
                    {#if selecting}
                        <!-- Only in selection mode: a column of empty boxes
                             down an ordinary graph would be asking a question
                             nobody had posed. -->
                        <span
                            aria-hidden="true"
                            class="mr-2 flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-[3px] border text-[9px] leading-none {comparedHashes.has(
                                commit.hash
                            )
                                ? 'border-warn bg-warn text-app'
                                : 'border-line-strong'}"
                        >
                            {comparedHashes.has(commit.hash) ? '✓' : ''}
                        </span>
                    {/if}
                    <div class="min-w-0 flex-1">
                        {@render row(commit, index)}
                    </div>
                </div>
            </button>
        {/each}
    </div>
</div>
