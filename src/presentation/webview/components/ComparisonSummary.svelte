<script lang="ts">
    import type { ComparisonDto } from '../../../application/dto/ComparisonDto';
    import type { Commit } from '../../../domain/models/Commit';

    interface Props {
        comparison: ComparisonDto;
        /** The commits this comparison covers, newest first, when it came from a selection. */
        commits?: Commit[];
    }

    let { comparison, commits = [] }: Props = $props();

    const methodLabel: Record<ComparisonDto['method'], string> = {
        mergeBase: 'Since the branches diverged',
        direct: 'Direct comparison',
        range: 'Contiguous range',
        singleCommit: 'This commit alone',
        replay: 'Reconstructed',
    };
</script>

<div class="flex h-full flex-col overflow-hidden">
    <div class="flex-shrink-0 space-y-3 border-b border-line px-4 py-3">
        <div>
            <p
                class="text-sm font-semibold tracking-wide text-fg-soft uppercase"
            >
                {comparison.label}
            </p>
            <p class="mt-0.5 text-[11px] text-fg-faint">
                {methodLabel[comparison.method]}
            </p>
        </div>

        <div class="flex items-baseline gap-3 text-sm tabular-nums">
            <span class="text-fg-soft">
                {`${comparison.totals.files} ${
                    comparison.totals.files === 1 ? 'file' : 'files'
                }`}
            </span>
            <span class="text-ok">+{comparison.totals.insertions}</span>
            <span class="text-danger">−{comparison.totals.deletions}</span>
            {#if comparison.totals.binaryFiles > 0}
                <span class="text-xs text-fg-faint">
                    {`${comparison.totals.binaryFiles} binary`}
                </span>
            {/if}
        </div>

        <p class="text-[11px] leading-snug text-fg-dim">
            {comparison.methodExplanation}
        </p>

        {#if comparison.skipped.length > 0}
            <div
                class="rounded border border-warn/30 bg-warn/10 px-2 py-1.5 text-[11px] text-warn-soft"
            >
                <p class="font-medium">
                    {comparison.skipped.length === 1
                        ? '1 commit left out'
                        : `${comparison.skipped.length} commits left out`}
                </p>
                <ul class="mt-1 space-y-0.5">
                    {#each comparison.skipped as entry (entry.hash)}
                        <li>
                            <code class="font-mono">
                                {entry.hash.slice(0, 8)}
                            </code>
                            {entry.reason}
                        </li>
                    {/each}
                </ul>
            </div>
        {/if}

        <p class="text-[11px] text-fg-faint">
            The changed files are in the <span class="text-fg-muted">Changes</span
            > view in the sidebar.
        </p>
    </div>

    {#if commits.length > 1}
        <div class="min-h-0 flex-1 overflow-y-auto">
            <p
                class="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider text-fg-faint uppercase"
            >
                {`Included commits (${commits.length})`}
            </p>
            <ul>
                {#each commits as commit (commit.hash)}
                    <li
                        class="flex items-baseline gap-2 px-4 py-1 text-xs {comparison.skipped.some(
                            (entry) => entry.hash === commit.hash
                        )
                            ? 'opacity-50'
                            : ''}"
                    >
                        <code class="flex-shrink-0 font-mono text-info">
                            {commit.shortHash}
                        </code>
                        <span class="min-w-0 flex-1 truncate text-fg-muted">
                            {commit.subject}
                        </span>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}
</div>
