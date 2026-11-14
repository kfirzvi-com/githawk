<script lang="ts">
    import type { CommitRepositoryDto } from '../../../application/dto/messages';

    interface Props {
        repository: CommitRepositoryDto;
        onSelectRepository?: () => void;
        onSwitchBranch?: () => void;
    }

    let { repository, onSelectRepository, onSwitchBranch }: Props = $props();
</script>

<!--
    The graph toolbar's two selectors, above the commit box: which repository
    a commit lands in, and on which branch. They are the only controls in the
    sidebar that move the graph — a click on a file never does.
-->
<div
    data-testid="commit-repository-bar"
    class="flex min-w-0 items-center gap-1.5 px-3 pt-2 text-xs"
>
    <button
        type="button"
        data-testid="commit-repository-picker"
        class="flex min-w-0 items-center gap-1.5 rounded-md border border-line-strong bg-control px-2 py-1 font-medium text-fg hover:bg-control-hover"
        title="{repository.detail}
{repository.count > 1
            ? `Click to switch between ${repository.count} repositories`
            : 'Click to switch repository or search again'}"
        onclick={() => onSelectRepository?.()}
    >
        <span class="text-fg-dim">▣</span>
        <span class="truncate">{repository.name}</span>
        {#if repository.count > 1}
            <span class="text-[10px] text-fg-dim">+{repository.count - 1}</span>
        {/if}
        <span class="text-[10px] text-fg-dim">▾</span>
    </button>
    <span class="text-fg-faint">/</span>
    <button
        type="button"
        data-testid="commit-branch-picker"
        class="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium text-fg-soft hover:bg-control-hover"
        title="Check out another branch"
        onclick={() => onSwitchBranch?.()}
    >
        <span class="h-2 w-2 shrink-0 rounded-full bg-ok"></span>
        <span class="truncate">{repository.branch ?? 'No commits yet'}</span>
        <span class="text-[10px] text-fg-dim">▾</span>
    </button>
</div>
