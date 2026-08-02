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
    class="flex items-center gap-3 border-b border-line-strong bg-graph px-4 py-3"
>
    {#if repository}
        <button
            type="button"
            data-testid="repository-picker"
            class="flex items-center gap-1.5 rounded-md border border-line-strong bg-control px-2 py-1 text-sm font-medium text-fg hover:bg-control-hover"
            title="{repository.detail}
{repository.count > 1
                ? `Click to switch between ${repository.count} repositories`
                : 'Click to switch repository or search again'}"
            onclick={() => onSelectRepository?.()}
        >
            <span class="text-xs text-fg-dim">▣</span>
            <span>{repository.name}</span>
            {#if repository.count > 1}
                <span class="text-[10px] text-fg-dim">
                    +{repository.count - 1}
                </span>
            {/if}
            <span class="text-[10px] text-fg-dim">▾</span>
        </button>
        <span class="text-fg-faint">/</span>
    {/if}

    <div class="flex items-center gap-2">
        <div class="h-2 w-2 rounded-full bg-ok"></div>
        <span class="text-sm font-medium text-fg-soft">
            {currentBranchName ?? 'Git Repository'}
        </span>
    </div>

    <div class="flex-1"></div>

    <div class="flex items-center gap-2">
        {#each toolbarActions as action (action.id)}
            <button
                type="button"
                class="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 {action.primary
                    ? 'bg-accent text-on-accent shadow-md hover:bg-accent-hover'
                    : 'border border-line-strong bg-control text-fg-soft hover:bg-control-hover'}"
                onclick={() => onAction?.(action.id)}
            >
                <span class="text-sm">{action.icon}</span>
                <span>{action.label}</span>
            </button>
        {/each}
    </div>
</div>
