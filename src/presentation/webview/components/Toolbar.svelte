<script lang="ts">
    import type { RepositoryLocation } from '../../../domain/models/RepositoryLocation';
    import {
        repositoryIndicator,
        toolbarActions,
        type ToolbarAction,
    } from '../viewmodels/toolbar';
    import ShortcutHint from './ShortcutHint.svelte';
    import type { ShortcutAction } from '../viewmodels/shortcuts';

    interface Props {
        currentBranchName?: string | null;
        repositories?: readonly RepositoryLocation[];
        activeRepositoryRoot?: string;
        onAction?: (action: ToolbarAction) => void;
        onSelectRepository?: () => void;
        /** Shift is down: every control that has a key says which. */
        hintsShown?: boolean;
        /** Which of them are live right now. */
        availableHints?: ReadonlySet<ShortcutAction>;
    }

    let {
        currentBranchName = null,
        repositories = [],
        activeRepositoryRoot = undefined,
        onAction,
        onSelectRepository,
        hintsShown = false,
        availableHints = new Set<ShortcutAction>(),
    }: Props = $props();

    /*
     * The toolbar action ids and the shortcut ids are the same four words, but
     * they are not the same type — one is a button, the other a key. Mapping
     * rather than casting keeps it that way, so adding a fifth button does not
     * silently promise a shortcut that does not exist.
     */
    const hintFor = (action: ToolbarAction): ShortcutAction => action;

    const hintShownFor = (action: ShortcutAction) =>
        hintsShown && availableHints.has(action);

    const repository = $derived(
        repositoryIndicator(repositories, activeRepositoryRoot)
    );
</script>

<div
    class="flex items-center gap-3 border-b border-line-strong bg-graph px-4 py-3"
>
    {#if repository}
        <div class="relative flex">
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
            <ShortcutHint
                action="switchRepository"
                shown={hintShownFor('switchRepository')}
            />
        </div>
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
        <!-- The one piece of the feature that is always visible: nobody holds
             a modifier down to see what happens, so something has to say that
             holding this one is worth it.

             The word rather than ⇧, for the reason the ref badges use shapes
             and the pane handles use a CSS triangle: the glyph is missing from
             the UI font VS Code picks on at least one platform, where it came
             out as an empty box. -->
        <span
            data-testid="shortcut-legend"
            class="mr-1 rounded border px-1.5 py-0.5 text-[10px] leading-none tracking-wide transition-colors duration-150 {hintsShown
                ? 'border-fg bg-fg text-app'
                : 'border-line-strong text-fg-faint'}"
            title="Hold Shift to see the keyboard shortcuts"
        >
            Shift
        </span>
        {#each toolbarActions as action (action.id)}
            <div class="relative flex">
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
                <ShortcutHint
                    action={hintFor(action.id)}
                    shown={hintShownFor(hintFor(action.id))}
                />
            </div>
        {/each}
    </div>
</div>
