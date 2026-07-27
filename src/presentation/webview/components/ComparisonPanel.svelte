<script lang="ts">
    import type {
        ComparisonDto,
        FileChangeDto,
    } from '../../../application/dto/ComparisonDto';

    interface Props {
        comparison: ComparisonDto;
        onOpenFile?: (file: FileChangeDto) => void;
        onClear?: () => void;
    }

    let { comparison, onOpenFile, onClear }: Props = $props();

    let filter = $state('');

    const visible = $derived(
        filter.trim().length === 0
            ? comparison.files
            : comparison.files.filter((file) =>
                  file.path.toLowerCase().includes(filter.trim().toLowerCase())
              )
    );

    const statusMark: Record<FileChangeDto['status'], string> = {
        added: 'A',
        modified: 'M',
        deleted: 'D',
        renamed: 'R',
        copied: 'C',
        typeChanged: 'T',
    };

    const statusColour: Record<FileChangeDto['status'], string> = {
        added: 'text-green-400',
        modified: 'text-blue-300',
        deleted: 'text-red-400',
        renamed: 'text-purple-300',
        copied: 'text-purple-300',
        typeChanged: 'text-amber-300',
    };

    const fileName = (path: string) => path.split('/').pop() ?? path;
    const directory = (path: string) => {
        const parts = path.split('/');
        parts.pop();
        return parts.join('/');
    };
</script>

<div class="flex h-full flex-col overflow-hidden bg-gray-850">
    <div class="space-y-2 border-b border-gray-700 px-4 py-3">
        <div class="flex items-baseline justify-between gap-2">
            <h2
                class="truncate text-sm font-semibold tracking-wide text-gray-200 uppercase"
                title={comparison.label}
            >
                {comparison.label}
            </h2>
            <button
                type="button"
                class="flex-shrink-0 text-xs text-gray-400 underline hover:text-gray-200"
                onclick={() => onClear?.()}
            >
                Close
            </button>
        </div>

        <div class="flex items-center gap-3 text-xs tabular-nums">
            <span class="text-gray-300">
                {comparison.totals.files}
                {comparison.totals.files === 1 ? 'file' : 'files'}
            </span>
            <span class="text-green-400">+{comparison.totals.insertions}</span>
            <span class="text-red-400">−{comparison.totals.deletions}</span>
            {#if comparison.totals.binaryFiles > 0}
                <span class="text-gray-500">
                    {comparison.totals.binaryFiles} binary
                </span>
            {/if}
        </div>

        <!-- How the "before" side was derived changes what the numbers mean, so
             it is stated rather than left implicit. -->
        <p class="text-[11px] leading-snug text-gray-500">
            {comparison.methodExplanation}
        </p>

        {#if comparison.skipped.length > 0}
            <div
                class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200"
            >
                <!-- One expression, so the sentence is a single text node: split
                     interpolations read as separate fragments to assistive tech
                     and to anything matching on text. -->
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

        {#if comparison.files.length > 12}
            <input
                type="search"
                bind:value={filter}
                placeholder="Filter files…"
                aria-label="Filter changed files"
                class="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
        {/if}
    </div>

    <div class="flex-1 overflow-y-auto">
        {#if comparison.files.length === 0}
            <p class="px-4 py-6 text-center text-sm text-gray-400">
                No differences.
            </p>
        {:else}
            {#each visible as file (file.path)}
                <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-700/50"
                    onclick={() => onOpenFile?.(file)}
                    title={file.previousPath
                        ? `${file.previousPath} → ${file.path}`
                        : file.path}
                >
                    <span
                        class="w-3 flex-shrink-0 font-mono text-xs {statusColour[
                            file.status
                        ]}"
                    >
                        {statusMark[file.status]}
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-xs text-gray-100">
                            {fileName(file.path)}
                        </span>
                        {#if directory(file.path)}
                            <span
                                class="block truncate text-[10px] text-gray-500"
                            >
                                {directory(file.path)}
                            </span>
                        {/if}
                    </span>
                    <span
                        class="flex-shrink-0 text-[10px] tabular-nums whitespace-nowrap"
                    >
                        {#if file.isBinary}
                            <span class="text-gray-500">binary</span>
                        {:else}
                            <span class="text-green-400">+{file.insertions}</span>
                            <span class="text-red-400">−{file.deletions}</span>
                        {/if}
                    </span>
                </button>
            {/each}
            {#if visible.length === 0}
                <p class="px-4 py-4 text-center text-xs text-gray-500 italic">
                    No files match.
                </p>
            {/if}
        {/if}
    </div>
</div>
