<script lang="ts">
    import type { Branch } from '../../domain/models/Branch';
    import type { Commit } from '../../domain/models/Commit';
    import { GraphLayoutService } from '../../domain/services/GraphLayoutService';
    import { BranchMapper, CommitMapper } from '../../application/dto/mappers';
    import BranchList from './components/BranchList.svelte';
    import CommitDetails from './components/CommitDetails.svelte';
    import GitGraph from './components/GitGraph.svelte';
    import RefBadge from './components/RefBadge.svelte';
    import ComparisonPanel from './components/ComparisonPanel.svelte';
    import type { ComparisonDto } from '../../application/dto/ComparisonDto';
    import {
        applySelection,
        emptySelection,
        isContiguous,
        type SelectModifiers,
        type SelectionState,
    } from './viewmodels/selection';
    import Toolbar from './components/Toolbar.svelte';
    import type { ToolbarAction } from './viewmodels/toolbar';
    import { onHostMessage, postToHost } from './vscodeApi';

    const layoutService = new GraphLayoutService();

    let commits = $state<Commit[]>([]);
    let branches = $state<Branch[]>([]);
    let selectedCommit = $state<Commit | null>(null);
    let errorMessage = $state<string | null>(null);
    let isLoading = $state(true);
    let hasMoreHistory = $state(false);
    let primaryBranchName = $state<string | undefined>(undefined);
    let selection = $state<SelectionState>(emptySelection);
    let comparison = $state<ComparisonDto | null>(null);
    let comparisonLoading = $state(false);
    let comparisonError = $state<string | null>(null);

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

    $effect(() =>
        onHostMessage((message) => {
            switch (message.type) {
                case 'graph:loaded':
                    commits = message.graph.commits.map(CommitMapper.fromDto);
                    branches = message.graph.branches.map(BranchMapper.fromDto);
                    hasMoreHistory = message.graph.hasMoreHistory;
                    primaryBranchName = message.graph.primaryBranchName;
                    errorMessage = null;
                    isLoading = false;
                    break;
                case 'graph:error':
                    errorMessage = message.message;
                    isLoading = false;
                    break;
                case 'comparison:loading':
                    comparisonLoading = true;
                    comparisonError = null;
                    break;
                case 'comparison:loaded':
                    comparison = message.comparison;
                    comparisonLoading = false;
                    comparisonError = null;
                    break;
                case 'comparison:error':
                    comparisonError = message.message;
                    comparisonLoading = false;
                    break;
                case 'comparison:cleared':
                    comparison = null;
                    comparisonLoading = false;
                    comparisonError = null;
                    break;
            }
        })
    );

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
        postToHost({ type: 'commit:select', hash: commit.hash });
    };

    const compareSelection = () => {
        postToHost({ type: 'compare:commits', hashes: selection.hashes });
    };

    const compareBranch = (includeWorkingTree: boolean) => {
        postToHost({ type: 'compare:branch', includeWorkingTree });
    };

    const clearComparison = () => {
        postToHost({ type: 'compare:clear' });
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
            <button
                type="button"
                class="mt-4 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                onclick={() => handleToolbarAction('refresh')}
            >
                Try again
            </button>
        </div>
    {:else}
        <div class="flex-shrink-0 border-b border-gray-700">
            <Toolbar
                {currentBranchName}
                onAction={handleToolbarAction}
                onCompareBranch={compareBranch}
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
                <button
                    type="button"
                    class="rounded bg-amber-500/80 px-2 py-1 font-medium text-gray-900 hover:bg-amber-400"
                    onclick={compareSelection}
                >
                    Review together
                </button>
                <button
                    type="button"
                    class="text-amber-200/80 underline hover:text-amber-100"
                    onclick={() => (selection = emptySelection)}
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
                    onOpenMenu={(branch) =>
                        postToHost({
                            type: 'branch:menu',
                            name: branch.name,
                            isRemote: branch.isRemote,
                            isCurrent: branch.isCurrent,
                        })}
                />
            </div>

            <div class="flex flex-1 flex-col overflow-hidden">
                <div class="flex-1 overflow-auto bg-gray-800">
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
                                                <RefBadge {ref} />
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
                                        {commit.message}
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
                {#if comparisonLoading}
                    <div
                        class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
                    >
                        <div
                            class="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-400"
                        ></div>
                        <p class="text-sm text-gray-400">Comparing…</p>
                    </div>
                {:else if comparisonError}
                    <div class="flex h-full flex-col justify-center gap-3 p-6">
                        <p class="text-sm font-medium text-red-300">
                            Could not compare
                        </p>
                        <p class="text-xs text-gray-400">{comparisonError}</p>
                        <button
                            type="button"
                            class="self-start text-xs text-gray-400 underline hover:text-gray-200"
                            onclick={clearComparison}
                        >
                            Dismiss
                        </button>
                    </div>
                {:else if comparison}
                    <ComparisonPanel
                        {comparison}
                        onClear={clearComparison}
                        onOpenFile={(file) =>
                            postToHost({
                                type: 'compare:openFile',
                                path: file.path,
                                previousPath: file.previousPath,
                                baseRev: comparison!.baseRev,
                                targetRev: comparison!.targetRev,
                            })}
                    />
                {:else}
                    <CommitDetails {selectedCommit} />
                {/if}
            </div>
        </div>
    {/if}
</div>
