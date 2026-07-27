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
    <div class="flex-shrink-0 space-y-3 border-b border-gray-700 px-4 py-3">
        <div>
            <p
                class="text-sm font-semibold tracking-wide text-gray-200 uppercase"
            >
                {comparison.label}
            </p>
            <p class="mt-0.5 text-[11px] text-gray-500">
                {methodLabel[comparison.method]}
            </p>
        </div>

        <div class="flex items-baseline gap-3 text-sm tabular-nums">
            <span class="text-gray-200">
                {`${comparison.totals.files} ${
                    comparison.totals.files === 1 ? 'file' : 'files'
                }`}
            </span>
            <span class="text-green-400">+{comparison.totals.insertions}</span>
            <span class="text-red-400">−{comparison.totals.deletions}</span>
            {#if comparison.totals.binaryFiles > 0}
                <span class="text-xs text-gray-500">
                    {`${comparison.totals.binaryFiles} binary`}
                </span>
            {/if}
        </div>

        <p class="text-[11px] leading-snug text-gray-400">
            {comparison.methodExplanation}
        </p>

        {#if comparison.skipped.length > 0}
            <div
                class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200"
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

        <p class="text-[11px] text-gray-500">
            The changed files are in the <span class="text-gray-300">Changes</span
            > view in the sidebar.
        </p>
    </div>

    {#if commits.length > 1}
        <div class="min-h-0 flex-1 overflow-y-auto">
            <p
                class="px-4 pt-3 pb-1 text-[11px] font-medium tracking-wider text-gray-500 uppercase"
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
                        <code class="flex-shrink-0 font-mono text-blue-300">
                            {commit.shortHash}
                        </code>
                        <span class="min-w-0 flex-1 truncate text-gray-300">
                            {commit.message}
                        </span>
                    </li>
                {/each}
            </ul>
        </div>
    {/if}
</div>
