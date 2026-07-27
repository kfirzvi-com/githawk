<script lang="ts">
    import type { Branch } from '../../domain/models/Branch';
    import type { Commit } from '../../domain/models/Commit';
    import { GraphLayoutService } from '../../domain/services/GraphLayoutService';
    import { BranchMapper, CommitMapper } from '../../application/dto/mappers';
    import BranchList from './components/BranchList.svelte';
    import CommitDetails from './components/CommitDetails.svelte';
    import GitGraph from './components/GitGraph.svelte';
    import RefBadge from './components/RefBadge.svelte';
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

    /** Layout is derived, never stored: one source of truth for the graph. */
    const graph = $derived(
        commits.length > 0
            ? layoutService.layout(commits, { primaryBranchName })
            : null
    );
    const currentBranchName = $derived(
        branches.find((b) => b.isCurrent)?.name ?? null
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

    const handleSelectCommit = (commit: Commit) => {
        selectedCommit = commit;
        postToHost({ type: 'commit:select', hash: commit.hash });
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
            <Toolbar {currentBranchName} onAction={handleToolbarAction} />
        </div>

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
                <CommitDetails {selectedCommit} />
            </div>
        </div>
    {/if}
</div>
