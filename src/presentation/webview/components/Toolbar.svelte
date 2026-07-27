<script lang="ts">
    import {
        toolbarActions,
        type ToolbarAction,
    } from '../viewmodels/toolbar';

    interface Props {
        currentBranchName?: string | null;
        onAction?: (action: ToolbarAction) => void;
        onCompareBranch?: (includeWorkingTree: boolean) => void;
    }

    let { currentBranchName = null, onAction, onCompareBranch }: Props =
        $props();

    // Including uncommitted work is the common case when reviewing your own
    // in-progress branch, so it is the default.
    let includeWorkingTree = $state(true);
</script>

<div
    class="flex items-center gap-3 border-b border-gray-600 bg-gray-800 px-4 py-3"
>
    <div class="flex items-center gap-2">
        <div class="h-2 w-2 rounded-full bg-green-400"></div>
        <span class="text-sm font-medium text-gray-200">
            {currentBranchName ?? 'Git Repository'}
        </span>
    </div>

    <div class="flex-1"></div>

    <label
        class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-400 select-none"
        title="Include changes you have not committed yet"
    >
        <input
            type="checkbox"
            bind:checked={includeWorkingTree}
            class="h-3 w-3 accent-blue-500"
        />
        uncommitted
    </label>

    <button
        type="button"
        class="flex items-center gap-2 rounded-md border border-gray-600 bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600"
        onclick={() => onCompareBranch?.(includeWorkingTree)}
        title="Review this whole branch against another one"
    >
        Review branch…
    </button>

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
