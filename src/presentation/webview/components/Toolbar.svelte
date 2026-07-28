<script lang="ts">
    import type { RepositoryLocation } from '../../../domain/models/RepositoryLocation';
    import {
        repositoryIndicator,
        toolbarActions,
        type ToolbarAction,
    } from '../viewmodels/toolbar';

    interface Props {
        currentBranchName?: string | null;
        repositories?: readonly RepositoryLocation[];
        activeRepositoryRoot?: string;
        onAction?: (action: ToolbarAction) => void;
        onSelectRepository?: () => void;
    }

    let {
        currentBranchName = null,
        repositories = [],
        activeRepositoryRoot = undefined,
        onAction,
        onSelectRepository,
    }: Props = $props();

    const repository = $derived(
        repositoryIndicator(repositories, activeRepositoryRoot)
    );
</script>

<div
    class="flex items-center gap-3 border-b border-gray-600 bg-gray-800 px-4 py-3"
>
    {#if repository}
        <button
            type="button"
            data-testid="repository-picker"
            class="flex items-center gap-1.5 rounded-md border border-gray-600 bg-gray-700 px-2 py-1 text-sm font-medium text-gray-100 hover:bg-gray-600"
            title="{repository.detail}
{repository.count > 1
                ? `Click to switch between ${repository.count} repositories`
                : 'Click to switch repository or search again'}"
            onclick={() => onSelectRepository?.()}
        >
            <span class="text-xs text-gray-400">▣</span>
            <span>{repository.name}</span>
            {#if repository.count > 1}
                <span class="text-[10px] text-gray-400">
                    +{repository.count - 1}
                </span>
            {/if}
            <span class="text-[10px] text-gray-400">▾</span>
        </button>
        <span class="text-gray-600">/</span>
    {/if}

    <div class="flex items-center gap-2">
        <div class="h-2 w-2 rounded-full bg-green-400"></div>
        <span class="text-sm font-medium text-gray-200">
            {currentBranchName ?? 'Git Repository'}
        </span>
    </div>

    <div class="flex-1"></div>

    <div class="flex items-center gap-2">
        {#each toolbarActions as action (action.id)}
            <button
                type="button"
                class="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 {action.primary
                    ? 'bg-blue-600 text-white shadow-md hover:bg-blue-500'
                    : 'border border-gray-600 bg-gray-700 text-gray-200 hover:bg-gray-600'}"
                onclick={() => onAction?.(action.id)}
            >
                <span class="text-sm">{action.icon}</span>
                <span>{action.label}</span>
            </button>
        {/each}
    </div>
</div>
