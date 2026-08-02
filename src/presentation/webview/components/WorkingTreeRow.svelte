<script lang="ts">
    import type { WorkingTreeStatus } from '../../../domain/models/WorkingTreeStatus';
    import { describeWorkingTree } from '../../../domain/models/WorkingTreeStatus';

    import {
        defaultMetrics,
        nodeCenter,
        type GraphMetrics,
    } from '../viewmodels/graphGeometry';

    interface Props {
        status: WorkingTreeStatus;
        gutterWidth: number;
        metrics?: GraphMetrics;
        selected: boolean;
        onSelect: () => void;
    }

    let {
        status,
        gutterWidth,
        metrics = defaultMetrics,
        selected,
        onSelect,
    }: Props = $props();

    const summary = $derived(describeWorkingTree(status));

    /*
     * The one place the count and the changeset disagree, so it is said rather
     * than left to be discovered: `git diff HEAD` has no blob to compare an
     * untracked file against, so those files are counted here and absent from
     * the diff. Counting them anyway is the lesser wrong — a row that ignored
     * five new files would report a clean tree that is not clean.
     */
    const untrackedOnlyCaveat = $derived(
        status.untracked > 0
            ? 'Everything uncommitted, compared against HEAD. Untracked files are counted here but not diffed — git has nothing to compare them with until they are added.'
            : 'Everything uncommitted, compared against HEAD.'
    );
    /** Lane 0's centre, so the marker lines up with the dots below it. */
    const markerLeft = $derived(
        nodeCenter(0, 0, metrics).x - metrics.dotRadius
    );
</script>

<button
    type="button"
    class="flex w-full items-center border-b border-dashed border-line text-left hover:bg-hover {selected
        ? 'bg-selected'
        : ''}"
    style="height:{metrics.rowH}px;"
    data-testid="working-tree-row"
    aria-pressed={selected}
    title={untrackedOnlyCaveat}
    onclick={onSelect}
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
