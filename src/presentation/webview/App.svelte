<script lang="ts">
    import type { Branch } from '../../domain/models/Branch';
    import type { Commit } from '../../domain/models/Commit';
    import type { Worktree } from '../../domain/models/Worktree';
    import { isBranchRef, type Ref } from '../../domain/models/Ref';
    import { GraphLayoutService } from '../../domain/services/GraphLayoutService';
    import {
        BranchMapper,
        CommitMapper,
        WorktreeMapper,
    } from '../../application/dto/mappers';
    import BranchList from './components/BranchList.svelte';
    import CommitDetails from './components/CommitDetails.svelte';
    import GitGraph from './components/GitGraph.svelte';
    import RefBadge from './components/RefBadge.svelte';
    import type { ComparisonDto } from '../../application/dto/ComparisonDto';
    import type { RepositoryLocation } from '../../domain/models/RepositoryLocation';
    import ComparisonSummary from './components/ComparisonSummary.svelte';
    import {
        applySelection,
        emptySelection,
        isContiguous,
        type SelectModifiers,
        type SelectionState,
    } from './viewmodels/selection';
    import Toolbar from './components/Toolbar.svelte';
    import type { ToolbarAction } from './viewmodels/toolbar';
    import { anchorAt, scrollTopFor } from './viewmodels/scrollAnchor';
    import { defaultMetrics } from './viewmodels/graphGeometry';
    import { onHostMessage, postToHost } from './vscodeApi';
    import { tick } from 'svelte';

    const layoutService = new GraphLayoutService();

    let commits = $state<Commit[]>([]);
    let branches = $state<Branch[]>([]);
    let selectedCommit = $state<Commit | null>(null);
    let errorMessage = $state<string | null>(null);
    let isLoading = $state(true);
    let hasMoreHistory = $state(false);
    let primaryBranchName = $state<string | undefined>(undefined);
    let selection = $state<SelectionState>(emptySelection);
    /** Files live in the Changes tree; this is kept only for the summary line. */
    let comparison = $state<ComparisonDto | null>(null);
    /** Empty until the host has scanned the workspace, and in the dev harness. */
    let repositories = $state<RepositoryLocation[]>([]);
    let activeRepositoryRoot = $state<string | undefined>(undefined);
    /** Working trees of the active repository. One is the common case. */
    let worktrees = $state<Worktree[]>([]);
    /** The graph's scroll container, so a reload can keep the reader's place. */
    let graphScroller = $state<HTMLDivElement | null>(null);

    /** Layout is derived, never stored: one source of truth for the graph. */
    const graph = $derived(
        commits.length > 0
            ? layoutService.layout(commits, { primaryBranchName })
            : null
    );
    const currentBranchName = $derived(
        branches.find((b) => b.isCurrent)?.name ?? null
    );
    const rowOrder = $derived(graph?.commits.map((c) => c.hash) ?? []);
    const selectedHashes = $derived(new Set(selection.hashes));
    const selectionIsContiguous = $derived(
        isContiguous(rowOrder, selection.hashes)
    );
    /**
     * A single commit still runs a comparison — that is what fills the Changes
     * tree — but its details belong in this panel, not a one-file summary. Only a
     * genuine aggregate (a selection, a branch review, a two-ref diff) replaces
     * them. Keying on the method rather than on the selection covers comparisons
     * that did not come from the graph at all.
     */
    const showAggregate = $derived(
        comparison !== null && comparison.method !== 'singleCommit'
    );

    /** Stats for the selected commit, shown alongside its details. */
    const selectedCommitTotals = $derived(
        comparison && comparison.method === 'singleCommit'
            ? comparison.totals
            : undefined
    );

    /** The selected commits themselves, so the summary can list them. */
    const selectedCommits = $derived(
        graph
            ? graph.commits.filter((commit) =>
                  selectedHashes.has(commit.hash)
              )
            : []
    );

    $effect(() =>
        onHostMessage((message) => {
            switch (message.type) {
                case 'graph:loaded': {
                    // Captured before the rows change, restored after. A reload
                    // the reader did not ask for must not move the page under
                    // them, and a new commit arrives at the top of the list.
                    const anchor = anchorAt(
                        graphScroller?.scrollTop ?? 0,
                        defaultMetrics.rowH,
                        rowOrder
                    );

                    commits = message.graph.commits.map(CommitMapper.fromDto);
                    branches = message.graph.branches.map(BranchMapper.fromDto);
                    hasMoreHistory = message.graph.hasMoreHistory;
                    primaryBranchName = message.graph.primaryBranchName;
                    errorMessage = null;
                    isLoading = false;

                    dropVanishedCommitsFromSelection();
                    if (anchor) {
                        void restoreScroll(anchor);
                    }
                    break;
                }
                case 'graph:error':
                    errorMessage = message.message;
                    isLoading = false;
                    break;
                case 'comparison:loaded':
                    comparison = message.comparison;
                    break;
                case 'comparison:cleared':
                    comparison = null;
                    break;
                case 'repositories:loaded':
                    if (message.activeRoot !== activeRepositoryRoot) {
                        // Hashes belong to a repository. Carrying a selection
                        // across a switch would ask the new one about commits
                        // it has never heard of.
                        selection = emptySelection;
                        selectedCommit = null;
                        comparison = null;
                        isLoading = true;
                    }
                    repositories = message.repositories;
                    activeRepositoryRoot = message.activeRoot;
                    break;
                case 'worktrees:loaded':
                    worktrees = message.worktrees.map(WorktreeMapper.fromDto);
                    break;
            }
        })
    );

    /**
     * `rowOrder` is derived from the commits that were just assigned, so the
     * new positions only exist once Svelte has flushed them.
     */
    const restoreScroll = async (
        anchor: NonNullable<ReturnType<typeof anchorAt>>
    ) => {
        await tick();
        const scrollTop = scrollTopFor(anchor, defaultMetrics.rowH, rowOrder);
        if (scrollTop !== null && graphScroller) {
            graphScroller.scrollTop = scrollTop;
        }
    };

    /**
     * An amend, a rebase, or a reset can take the selected commit out of the
     * graph. Keeping it selected leaves the details panel describing a commit
     * that is no longer reachable, and its files in a tree that can no longer
     * open them.
     */
    const dropVanishedCommitsFromSelection = () => {
        const present = new Set(rowOrder);
        const surviving = selection.hashes.filter((hash) => present.has(hash));
        if (surviving.length === selection.hashes.length) {
            return;
        }

        selection = { ...selection, hashes: surviving };
        if (selectedCommit && !present.has(selectedCommit.hash)) {
            selectedCommit = null;
        }
        postToHost({ type: 'compare:clear' });
        comparison = null;
    };

    /**
     * The same request the branch list sends, so a badge in the graph and a row
     * in the list open one menu rather than two that drift apart. A tag and a
     * detached HEAD are drawn as badges too and have no branch menu, so only
     * branch refs are given this.
     */
    const openBranchMenu = (ref: Ref) =>
        postToHost({
            type: 'branch:menu',
            name: ref.name,
            isRemote: ref.kind === 'remoteBranch',
            isCurrent: ref.isHead,
        });

    const handleToolbarAction = (action: ToolbarAction) => {
        if (action === 'refresh') {
            isLoading = true;
            postToHost({ type: 'graph:refresh' });
            return;
        }

        postToHost({ type: 'remote:operation', operation: action });
    };

    const handleSelectCommit = (commit: Commit, modifiers: SelectModifiers) => {
        selection = applySelection(
            selection,
            rowOrder,
            commit.hash,
            modifiers
        );
        selectedCommit = commit;
        requestChangesForSelection();
    };

    /**
     * Selecting commits is the request: one commit shows its own changes, several
     * show their combined effect. Debounced because building a selection is
     * several clicks, and each intermediate state would otherwise start work — for
     * a multi-commit selection that means spawning a worktree per click.
     */
    let pendingRequest: ReturnType<typeof setTimeout> | undefined;
    const requestChangesForSelection = () => {
        clearTimeout(pendingRequest);
        const hashes = [...selection.hashes];

        pendingRequest = setTimeout(() => {
            if (hashes.length === 0) {
                postToHost({ type: 'compare:clear' });
                return;
            }
            if (hashes.length === 1) {
                postToHost({ type: 'commit:select', hash: hashes[0] });
                return;
            }
            postToHost({ type: 'compare:commits', hashes });
        }, 180);
    };

    const clearSelection = () => {
        selection = emptySelection;
        requestChangesForSelection();
    };

    /**
     * Diff exactly two commits against each other. Distinct from reviewing them
     * together: this asks how two states differ, not what the two commits changed.
     */
    /** Jumping to a parent from the details panel, when it is on screen. */
    const selectParentByHash = (hash: string) => {
        const parent = graph?.commits.find((commit) => commit.hash === hash);
        if (parent) {
            handleSelectCommit(parent, { toggle: false, range: false });
        }
    };

    const compareTwoSelected = () => {
        // Rows are newest-first, so the second selected is the older side.
        const [right, left] = [...selection.hashes];
        postToHost({ type: 'compare:twoCommits', left, right });
    };
</script>

<div class="flex h-screen flex-col bg-gray-900 font-sans text-gray-100">
    {#if isLoading}
        <div class="flex h-full flex-col items-center justify-center">
            <div
                class="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-400"
            ></div>
            <div class="text-lg font-medium text-gray-200">
                Loading Git Repository
            </div>
            <div class="mt-2 text-sm text-gray-400">
                Reading commit history…
            </div>
        </div>
    {:else if errorMessage}
        <div
            class="flex h-full flex-col items-center justify-center p-8 text-center"
        >
            <div class="mb-2 text-lg font-medium text-red-300">
                Could not load the graph
            </div>
            <p class="max-w-md text-sm text-gray-400">{errorMessage}</p>
            <div class="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                    onclick={() => handleToolbarAction('refresh')}
                >
                    Try again
                </button>
                <!-- Failing to load one repository is a common reason to want a
                     different one, and the toolbar is not rendered here. -->
                {#if repositories.length > 0}
                    <button
                        type="button"
                        data-testid="repository-picker-error"
                        class="rounded-md border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
                        onclick={() =>
                            postToHost({ type: 'repository:menu' })}
                    >
                        Switch repository
                    </button>
                {/if}
            </div>
        </div>
    {:else}
        <div class="flex-shrink-0 border-b border-gray-700">
            <Toolbar
                {currentBranchName}
                {repositories}
                {activeRepositoryRoot}
                onAction={handleToolbarAction}
                onSelectRepository={() =>
                    postToHost({ type: 'repository:menu' })}
            />
        </div>

        {#if selection.hashes.length > 1}
            <!-- Only shown once a multi-selection exists, so the normal case
                 keeps its full height. -->
            <div
                class="flex flex-shrink-0 items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs"
            >
                <span class="font-medium text-amber-100">
                    {selection.hashes.length} commits selected
                </span>
                <span class="text-amber-200/70">
                    {selectionIsContiguous
                        ? 'contiguous range'
                        : 'not contiguous — will be reconstructed'}
                </span>
                <div class="flex-1"></div>
                {#if selection.hashes.length === 2}
                    <!-- The combined effect is shown automatically; this asks the
                         other question, how the two states differ. -->
                    <button
                        type="button"
                        class="rounded border border-amber-500/50 px-2 py-1 font-medium text-amber-100 hover:bg-amber-500/20"
                        onclick={compareTwoSelected}
                        title="How do these two commits differ?"
                    >
                        Diff the two instead
                    </button>
                {/if}
                <button
                    type="button"
                    class="text-amber-200/80 underline hover:text-amber-100"
                    onclick={clearSelection}
                >
                    Clear
                </button>
            </div>
        {/if}

        <div class="flex flex-1 overflow-hidden">
            <div
                class="w-64 flex-shrink-0 border-r border-gray-700 bg-gray-850"
            >
                <BranchList
                    {branches}
                    {worktrees}
                    onOpenMenu={(branch) =>
                        postToHost({
                            type: 'branch:menu',
                            name: branch.name,
                            isRemote: branch.isRemote,
                            isCurrent: branch.isCurrent,
                        })}
                    onOpenWorktreeMenu={(path) =>
                        postToHost({ type: 'worktree:menu', path })}
                />
            </div>

            <div class="flex flex-1 flex-col overflow-hidden">
                <div
                    bind:this={graphScroller}
                    class="flex-1 overflow-auto bg-gray-800"
                    data-testid="graph-scroller"
                >
                    {#if graph}
                        <GitGraph
                            {graph}
                            selectedHash={selectedCommit?.hash ?? null}
                            comparedHashes={selectedHashes}
                            onSelect={handleSelectCommit}
                            onContextMenu={(commit) =>
                                postToHost({
                                    type: 'commit:menu',
                                    hash: commit.hash,
                                })}
                        >
                            {#snippet row(commit: Commit)}
                                <!-- Fixed-width metadata columns with the
                                     message absorbing the slack, so the author
                                     never wraps and the date never shifts. -->
                                <div class="flex items-center gap-3">
                                    <span
                                        class="w-16 flex-shrink-0 font-mono text-xs whitespace-nowrap text-blue-300"
                                    >
                                        {commit.shortHash}
                                    </span>
                                    {#if commit.refs.length > 0}
                                        <span
                                            class="flex flex-shrink-0 items-center gap-1"
                                        >
                                            {#each commit.sortedRefs.slice(0, 3) as ref (ref.kind + ref.name)}
                                                <RefBadge
                                                    {ref}
                                                    onActivate={
                                                        isBranchRef(ref)
                                                            ? openBranchMenu
                                                            : undefined
                                                    }
                                                />
                                            {/each}
                                            {#if commit.refs.length > 3}
                                                <span
                                                    class="text-[10px] text-gray-500"
                                                    title={commit.sortedRefs
                                                        .slice(3)
                                                        .map((r) => r.name)
                                                        .join(', ')}
                                                >
                                                    +{commit.refs.length - 3}
                                                </span>
                                            {/if}
                                        </span>
                                    {/if}
                                    <span
                                        class="min-w-0 flex-1 truncate text-sm font-medium text-gray-100"
                                        title={commit.message}
                                    >
                                        {commit.subject}
                                    </span>
                                    <span
                                        class="w-32 flex-shrink-0 truncate text-right text-xs whitespace-nowrap text-gray-400"
                                        title={commit.author}
                                    >
                                        {commit.author}
                                    </span>
                                    <span
                                        class="w-20 flex-shrink-0 pr-3 text-right text-xs whitespace-nowrap tabular-nums text-gray-500"
                                    >
                                        {commit.timestamp.toLocaleDateString()}
                                    </span>
                                </div>
                            {/snippet}
                        </GitGraph>
                        {#if hasMoreHistory}
                            <div
                                class="border-t border-gray-700 px-3 py-2 text-center text-xs text-gray-500"
                            >
                                Older history not shown — raise
                                <code class="text-gray-400">
                                    gitHawk.commitLimit
                                </code>
                                to load more.
                            </div>
                        {/if}
                    {:else}
                        <div
                            class="flex h-full items-center justify-center text-sm text-gray-400"
                        >
                            This repository has no commits yet.
                        </div>
                    {/if}
                </div>
            </div>

            <div
                class="w-80 flex-shrink-0 border-l border-gray-700 bg-gray-850"
            >
                {#if showAggregate && comparison}
                    <ComparisonSummary
                        {comparison}
                        commits={selectedCommits}
                    />
                {:else}
                    <CommitDetails
                        {selectedCommit}
                        totals={selectedCommitTotals}
                        onCopyHash={(hash) =>
                            postToHost({ type: 'commit:copyHash', hash })}
                        onSelectParent={selectParentByHash}
                    />
                {/if}
            </div>
        </div>
    {/if}
</div>
