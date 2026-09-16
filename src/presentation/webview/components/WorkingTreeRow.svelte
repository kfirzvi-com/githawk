<script lang="ts">
    import type { WorkingTreeStatus } from '../../../domain/models/WorkingTreeStatus';
    import { describeWorkingTree } from '../../../domain/models/WorkingTreeStatus';

    import {
        defaultMetrics,
        nodeCenter,
        type GraphMetrics,
    } from '../viewmodels/graphGeometry';
    import {
        WORKING_TREE_ROW,
        resolveGraphKey,
        type GraphKeyAction,
    } from '../viewmodels/graphKeys';

    interface Props {
        status: WorkingTreeStatus;
        gutterWidth: number;
        metrics?: GraphMetrics;
        selected: boolean;
        onSelect: () => void;
        /** The keyboard is on this row. Drawn as the graph draws its cursor. */
        cursor?: boolean;
        /**
         * Whether Tab lands here. One row in the whole list is tabbable at a
         * time — this one when the cursor is here, a commit otherwise — so
         * the graph and this row share one roving tabindex.
         */
        tabbable?: boolean;
        /** Space picks in the graph; here it is the click, so nothing is picked. */
        selecting?: boolean;
        /** The arrows and Enter, resolved the way the graph resolves them. */
        onGraphKey?: (action: GraphKeyAction, row: string) => void;
    }

    let {
        status,
        gutterWidth,
        metrics = defaultMetrics,
        selected,
        onSelect,
        cursor = false,
        tabbable = false,
        selecting = false,
        onGraphKey,
    }: Props = $props();

    const handleKeyDown = (event: KeyboardEvent) => {
        const action = resolveGraphKey(event, selecting);
        if (!action) {
            return;
        }
        event.preventDefault();
        onGraphKey?.(action, WORKING_TREE_ROW);
    };

    const summary = $derived(describeWorkingTree(status));

    /* What the row leads to, for the hover. */
    const untrackedOnlyCaveat =
        'Everything not yet committed — staged, changed, and untracked — with a commit box above the files.';
    /** Lane 0's centre, so the marker lines up with the dots below it. */
    const markerLeft = $derived(
        nodeCenter(0, 0, metrics).x - metrics.dotRadius
    );
</script>

<button
    type="button"
    class="flex w-full items-center border-b border-dashed border-line text-left hover:bg-hover focus:outline-none {selected
        ? 'bg-selected'
        : ''} {cursor
        ? 'outline-2 -outline-offset-2 outline-info-strong focus:outline'
        : ''}"
    style="height:{metrics.rowH}px;"
    data-testid="working-tree-row"
    data-hash={WORKING_TREE_ROW}
    aria-pressed={selected}
    aria-current={cursor ? 'true' : undefined}
    tabindex={tabbable ? 0 : -1}
    title={untrackedOnlyCaveat}
    onclick={onSelect}
    onkeydown={handleKeyDown}
>
    <!-- Aligned with the graph's lane gutter so the marker sits above the
         topmost commit dot, rather than floating in its own column. -->
    <div
        class="flex flex-shrink-0 items-center justify-start"
        style="width:{gutterWidth}px; min-width:60px; padding-left:{markerLeft}px;"
    >
        <!--
            Hollow and dashed, unlike every commit dot, because this is not a
            commit: it has no hash, nothing points at it, and it will look
            different the moment anyone saves a file. Drawn rather than
            connected to HEAD by an edge — the graph reads every ref, so the
            topmost row is not necessarily the commit these changes sit on,
            and a line claiming otherwise would be wrong about a third of the
            time.
        -->
        <span
            aria-hidden="true"
            class="rounded-full border border-dashed border-warn/80"
            style="width:{metrics.dotRadius * 2}px; height:{metrics.dotRadius * 2}px;"
        ></span>
    </div>
    <div class="flex min-w-0 flex-1 items-center gap-3 pl-2">
        <span
            class="w-16 flex-shrink-0 font-mono text-xs whitespace-nowrap text-warn/70"
        >
            —
        </span>
        <span class="min-w-0 flex-1 truncate text-sm font-medium text-warn-soft">
            Uncommitted changes
        </span>
        <span
            class="flex-shrink-0 truncate pr-3 text-right text-xs whitespace-nowrap text-warn-soft/70"
            data-testid="working-tree-summary"
        >
            {summary}
        </span>
    </div>
</button>
