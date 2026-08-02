<script lang="ts">
    import type { Branch } from '../../domain/models/Branch';
    import type { Commit } from '../../domain/models/Commit';
    import type { Worktree } from '../../domain/models/Worktree';
    import { isBranchRef, type Ref } from '../../domain/models/Ref';
    import { GraphLayoutService } from '../../domain/services/GraphLayoutService';
    import {
        BranchMapper,
        CommitMapper,
        StashMapper,
        WorktreeMapper,
    } from '../../application/dto/mappers';
    import type { Stash } from '../../domain/models/Stash';
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
    import {
        isRemoteOperation,
        type ToolbarAction,
    } from './viewmodels/toolbar';
    import { anchorAt, scrollTopFor } from './viewmodels/scrollAnchor';
    import {
        defaultMetrics,
        graphWidth,
    } from './viewmodels/graphGeometry';
    import { tick } from 'svelte';
    import PaneHandle from './components/PaneHandle.svelte';
    import WorkingTreeRow from './components/WorkingTreeRow.svelte';
    import {
        cleanWorkingTree,
        isClean,
        type WorkingTreeStatus,
    } from '../../domain/models/WorkingTreeStatus';
    import {
        readPaneVisibility,
        withPane,
        type Pane,
    } from './viewmodels/panes';
    import {
        onHostMessage,
        postToHost,
        readWebviewState,
        writeWebviewState,
    } from './vscodeApi';

    /** Persisted, so folding a pane away survives the panel being rebuilt. */
    const PANES_STATE_KEY = 'panes';

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
    /** Listed in the sidebar; the same entries are rows in the graph. */
    let stashes = $state<Stash[]>([]);
    /** The graph's scroll container, so a reload can keep the reader's place. */
    let graphScroller = $state<HTMLDivElement | null>(null);
    let panes = $state(readPaneVisibility(readWebviewState(PANES_STATE_KEY)));
    /** Counts only; the files themselves go to the Changes tree as usual. */
    let workingTree = $state<WorkingTreeStatus>(cleanWorkingTree);
    let workingTreeSelected = $state(false);

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
    const workingTreeIsClean = $derived(isClean(workingTree));
    /**
     * The working-tree row shares the graph's scroll container and sits above
     * row 0, so every commit is that much further down than its index says.
     * Scroll anchoring maps pixels to rows arithmetically — rows are a fixed
     * height, which is what makes it cheap — so it has to be told.
     */
    const graphScrollOffset = $derived(
        workingTreeIsClean ? 0 : defaultMetrics.rowH
    );
    /**
     * The same width GitGraph reserves for its lanes, computed the same way, so
     * the working-tree marker sits above the commit dots rather than beside
     * them. The row cannot live inside GitGraph: that component maps rows to
     * pixels by index, and a row that is not a commit would shift every node
     * off its edge.
     */
    const graphGutterWidth = $derived(
        graph
            ? graphWidth(
                  graph.nodes.reduce((max, node) => Math.max(max, node.lane), 0),
                  defaultMetrics
              )
            : 0
    );
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
                        (graphScroller?.scrollTop ?? 0) - graphScrollOffset,
                        defaultMetrics.rowH,
                        rowOrder
                    );

                    commits = message.graph.commits.map(CommitMapper.fromDto);
                    branches = message.graph.branches.map(BranchMapper.fromDto);
                    stashes = message.graph.stashes.map(StashMapper.fromDto);
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
                case 'commit:reveal': {
                    // Arriving from a blame hover. The commit may be below the
                    // fold, so selecting it is not enough to show it.
                    const commit = graph?.commits.find(
                        (candidate) => candidate.hash === message.hash
                    );
                    if (commit) {
                        workingTreeSelected = false;
                        selection = applySelection(selection, rowOrder, commit.hash, {
                            toggle: false,
                            range: false,
                        });
                        selectedCommit = commit;
                        void scrollCommitIntoView(commit.hash);
                    }
                    break;
                }
                case 'workingTree:loaded':
                    workingTree = message.status;
                    // Committing everything removes the row; leaving it
                    // selected would keep a changeset on screen that no longer
                    // has anything in it.
                    if (isClean(message.status)) {
                        workingTreeSelected = false;
                    }
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
            // Re-read rather than captured: committing everything takes the
            // working-tree row away, and the rows below it move up by one.
            graphScroller.scrollTop = scrollTop + graphScrollOffset;
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

    const togglePane = (pane: Pane) => {
        panes = withPane(panes, pane, !panes[pane]);
        writeWebviewState(PANES_STATE_KEY, panes);
    };

    const handleToolbarAction = (action: ToolbarAction) => {
        if (action === 'refresh') {
            isLoading = true;
            postToHost({ type: 'graph:refresh' });
            return;
        }
        if (action === 'remotes') {
            postToHost({ type: 'remotes:menu' });
            return;
        }
        if (isRemoteOperation(action)) {
            postToHost({ type: 'remote:operation', operation: action });
        }
    };

    const handleSelectCommit = (commit: Commit, modifiers: SelectModifiers) => {
        // The two selections are mutually exclusive: "these commits, and also
        // whatever is uncommitted" is a different question, and the branch
        // menu's "Review my work against…" is the one that answers it.
        workingTreeSelected = false;
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
     * Centres a row rather than merely bringing it to an edge: a commit
     * revealed from somewhere else needs its neighbours visible to be worth
     * revealing at all.
     */
    const scrollCommitIntoView = async (hash: string) => {
        await tick();
        const index = rowOrder.indexOf(hash);
        if (index < 0 || !graphScroller) {
            return;
        }

        const target =
            index * defaultMetrics.rowH +
            graphScrollOffset -
            graphScroller.clientHeight / 2;
        graphScroller.scrollTop = Math.max(0, target);
    };

    const selectWorkingTree = () => {
        workingTreeSelected = true;
        selection = emptySelection;
        selectedCommit = null;
        // Not debounced, unlike a commit selection: this row cannot be part of
        // a range, so one click is the whole request.
        clearTimeout(pendingRequest);
        postToHost({ type: 'workingTree:select' });
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

<div class="flex h-screen flex-col bg-app font-sans text-fg">
    {#if isLoading}
        <div class="flex h-full flex-col items-center justify-center">
            <div
                class="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-info-strong"
            ></div>
            <div class="text-lg font-medium text-fg-soft">
                Loading Git Repository
            </div>
            <div class="mt-2 text-sm text-fg-dim">
                Reading commit history…
            </div>
        </div>
    {:else if errorMessage}
        <div
            class="flex h-full flex-col items-center justify-center p-8 text-center"
        >
            <div class="mb-2 text-lg font-medium text-danger">
                Could not load the graph
            </div>
            <p class="max-w-md text-sm text-fg-dim">{errorMessage}</p>
            <div class="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
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
                        class="rounded-md border border-line-strong bg-control px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-control-hover"
                        onclick={() =>
                            postToHost({ type: 'repository:menu' })}
                    >
                        Switch repository
                    </button>
                {/if}
            </div>
        </div>
    {:else}
        <div class="flex-shrink-0 border-b border-line">
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
                class="flex flex-shrink-0 items-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs"
            >
                <span class="font-medium text-warn-soft">
                    {selection.hashes.length} commits selected
                </span>
                <span class="text-warn-soft/70">
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
                        class="rounded border border-warn/50 px-2 py-1 font-medium text-warn-soft hover:bg-warn/20"
                        onclick={compareTwoSelected}
                        title="How do these two commits differ?"
                    >
                        Diff the two instead
                    </button>
                {/if}
                <button
                    type="button"
                    class="text-warn-soft/80 underline hover:text-warn-soft"
                    onclick={clearSelection}
                >
                    Clear
                </button>
            </div>
        {/if}

        <div class="flex flex-1 overflow-hidden">
            {#if panes.branches}
                <div class="w-64 flex-shrink-0 bg-pane">
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
                        {stashes}
                        onOpenStashMenu={(ref) =>
                            postToHost({ type: 'stash:menu', ref })}
                    />
                </div>
            {/if}
            <!-- Always rendered, collapsed or not: the way back is in the same
                 place as the way out, so folding a pane away cannot hide its
                 own control. -->
            <PaneHandle
                pane="branches"
                side="left"
                visible={panes.branches}
                onToggle={togglePane}
            />

            <div class="flex flex-1 flex-col overflow-hidden">
                <div
                    bind:this={graphScroller}
                    class="flex-1 overflow-auto bg-graph"
                    data-testid="graph-scroller"
                >
                    {#if graph && !workingTreeIsClean}
                        <!-- Above the graph and inside its scroller, because it
                             belongs at the newest end of the history and should
                             scroll away with it. -->
                        <WorkingTreeRow
                            status={workingTree}
                            gutterWidth={graphGutterWidth}
                            selected={workingTreeSelected}
                            onSelect={selectWorkingTree}
                        />
                    {/if}
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
                                        class="w-16 flex-shrink-0 font-mono text-xs whitespace-nowrap text-info"
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
                                                    class="text-[10px] text-fg-faint"
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
                                        class="min-w-0 flex-1 truncate text-sm font-medium text-fg"
                                        title={commit.message}
                                    >
                                        {commit.subject}
                                    </span>
                                    <span
                                        class="w-32 flex-shrink-0 truncate text-right text-xs whitespace-nowrap text-fg-dim"
                                        title={commit.author}
                                    >
                                        {commit.author}
                                    </span>
                                    <span
                                        class="w-20 flex-shrink-0 pr-3 text-right text-xs whitespace-nowrap tabular-nums text-fg-faint"
                                    >
                                        {commit.timestamp.toLocaleDateString()}
                                    </span>
                                </div>
                            {/snippet}
                        </GitGraph>
                        {#if hasMoreHistory}
                            <div
                                class="border-t border-line px-3 py-2 text-center text-xs text-fg-faint"
                            >
                                Older history not shown — raise
                                <code class="text-fg-dim">
                                    gitHawk.commitLimit
                                </code>
                                to load more.
                            </div>
                        {/if}
                    {:else}
                        <div
                            class="flex h-full items-center justify-center text-sm text-fg-dim"
                        >
                            This repository has no commits yet.
                        </div>
                    {/if}
                </div>
            </div>

            <PaneHandle
                pane="details"
                side="right"
                visible={panes.details}
                onToggle={togglePane}
            />
            {#if panes.details}
                <div class="w-80 flex-shrink-0 bg-pane">
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
            {/if}
        </div>
    {/if}
</div>
