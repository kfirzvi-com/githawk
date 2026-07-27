<script lang="ts">
    import type { Commit } from '../../../domain/models/Commit';
    import RefBadge from './RefBadge.svelte';

    interface Props {
        selectedCommit?: Commit | null;
        onCopyHash?: (hash: string) => void;
        onSelectParent?: (hash: string) => void;
    }

    let { selectedCommit = null, onCopyHash, onSelectParent }: Props = $props();

    const absolute = (date: Date) =>
        date.toLocaleString(undefined, {
            dateStyle: 'full',
            timeStyle: 'short',
        });

    /**
     * "3 days ago" alongside the exact date. The relative form is what people
     * actually reason about; the absolute one is what they need when it matters.
     */
    function relative(date: Date): string {
        const seconds = Math.round((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) {
            return 'just now';
        }

        const units: [Intl.RelativeTimeFormatUnit, number][] = [
            ['year', 60 * 60 * 24 * 365],
            ['month', 60 * 60 * 24 * 30],
            ['week', 60 * 60 * 24 * 7],
            ['day', 60 * 60 * 24],
            ['hour', 60 * 60],
            ['minute', 60],
        ];

        const formatter = new Intl.RelativeTimeFormat(undefined, {
            numeric: 'auto',
        });
        for (const [unit, secondsPerUnit] of units) {
            if (Math.abs(seconds) >= secondsPerUnit) {
                return formatter.format(
                    -Math.round(seconds / secondsPerUnit),
                    unit
                );
            }
        }
        return 'just now';
    }

    const initial = $derived(
        (selectedCommit?.author || '?').trim().charAt(0).toUpperCase()
    );
</script>

{#if selectedCommit}
    <div
        class="flex h-full flex-col overflow-hidden"
        data-testid="commit-details"
    >
        <div
            class="flex flex-shrink-0 items-baseline justify-between gap-2 border-b border-gray-700 px-4 py-3"
        >
            <h2
                class="text-sm font-semibold tracking-wide text-gray-200 uppercase"
            >
                Commit
            </h2>
            <span class="flex items-center gap-2 text-[11px] text-gray-500">
                {#if selectedCommit.isMergeCommit}
                    <span
                        class="rounded border border-purple-500/30 bg-purple-500/15 px-1.5 py-0.5 text-purple-200"
                    >
                        merge
                    </span>
                {/if}
                {#if selectedCommit.isRootCommit}
                    <span
                        class="rounded border border-gray-600 bg-gray-700/50 px-1.5 py-0.5 text-gray-300"
                    >
                        root
                    </span>
                {/if}
            </span>
        </div>

        <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <!-- Subject and body, kept distinct: git treats the first line as the
                 summary and everything after it as prose, and so should we. -->
            <div class="space-y-2">
                <p
                    class="text-sm leading-snug font-semibold text-gray-100"
                    style="overflow-wrap:anywhere;"
                >
                    {selectedCommit.subject || '(no message)'}
                </p>
                {#if selectedCommit.hasBody}
                    <!-- Preserves the author's own line breaks and indentation,
                         which carry meaning in bullet lists and trailers. -->
                    <pre
                        class="font-sans text-xs leading-relaxed whitespace-pre-wrap text-gray-300"
                        style="overflow-wrap:anywhere;">{selectedCommit.body}</pre>
                {/if}
            </div>

            {#if selectedCommit.refs.length > 0}
                <div class="flex flex-wrap gap-1.5">
                    {#each selectedCommit.sortedRefs as ref (ref.kind + ref.name)}
                        <RefBadge {ref} />
                    {/each}
                </div>
            {/if}

            <div class="space-y-3 border-t border-gray-700/70 pt-4">
                <div class="flex items-center gap-3">
                    <div
                        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-medium text-white"
                    >
                        {initial}
                    </div>
                    <div class="min-w-0">
                        <p class="truncate text-sm text-gray-200">
                            {selectedCommit.author || 'Unknown'}
                        </p>
                        {#if selectedCommit.authorEmail}
                            <p class="truncate text-[11px] text-gray-500">
                                {selectedCommit.authorEmail}
                            </p>
                        {/if}
                    </div>
                </div>

                <div class="space-y-1">
                    <p class="text-xs text-gray-300">
                        {relative(selectedCommit.timestamp)}
                    </p>
                    <p class="text-[11px] text-gray-500">
                        {absolute(selectedCommit.timestamp)}
                    </p>
                </div>

                {#if selectedCommit.wasRewritten}
                    <!-- Only shown when it differs, because an identical
                         committer is noise. When it differs it is the explanation
                         for a date that otherwise looks wrong. -->
                    <div
                        class="rounded border border-gray-700 bg-gray-800/60 px-2 py-1.5 text-[11px] text-gray-400"
                    >
                        <p class="text-gray-300">Committed separately</p>
                        {#if selectedCommit.committer && selectedCommit.committer !== selectedCommit.author}
                            <p>by {selectedCommit.committer}</p>
                        {/if}
                        {#if selectedCommit.committedAt}
                            <p>{absolute(selectedCommit.committedAt)}</p>
                        {/if}
                        <p class="mt-1 text-gray-500 italic">
                            Typical of a rebase, cherry-pick, or applied patch.
                        </p>
                    </div>
                {/if}
            </div>

            <div class="space-y-1.5 border-t border-gray-700/70 pt-4">
                <div class="flex items-center justify-between gap-2">
                    <span
                        class="text-[11px] font-medium tracking-wider text-gray-500 uppercase"
                    >
                        Commit hash
                    </span>
                    <button
                        type="button"
                        class="text-[11px] text-gray-400 underline hover:text-gray-200"
                        onclick={() => onCopyHash?.(selectedCommit.hash)}
                    >
                        Copy
                    </button>
                </div>
                <code
                    class="block rounded border border-gray-700 bg-gray-800 p-2 font-mono text-[11px] break-all text-blue-300"
                >
                    {selectedCommit.hash}
                </code>
            </div>

            <div class="space-y-1.5 border-t border-gray-700/70 pt-4">
                <span
                    class="text-[11px] font-medium tracking-wider text-gray-500 uppercase"
                >
                    {selectedCommit.parentHashes.length === 1
                        ? 'Parent'
                        : 'Parents'}
                </span>
                {#if selectedCommit.parentHashes.length > 0}
                    <div class="flex flex-wrap gap-1.5">
                        {#each selectedCommit.parentHashes as parent (parent)}
                            <button
                                type="button"
                                class="rounded bg-gray-700 px-2 py-1 font-mono text-[11px] text-gray-300 hover:bg-gray-600 hover:text-gray-100"
                                title={`Select ${parent}`}
                                onclick={() => onSelectParent?.(parent)}
                            >
                                {parent.slice(0, 8)}
                            </button>
                        {/each}
                    </div>
                {:else}
                    <p class="text-xs text-gray-500 italic">
                        None — this is the first commit.
                    </p>
                {/if}
            </div>
        </div>
    </div>
{:else}
    <div
        class="flex h-full flex-col items-center justify-center p-8 text-center"
        data-testid="commit-details-empty"
    >
        <div
            class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-700"
        >
            <svg
                class="h-8 w-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
            </svg>
        </div>
        <h3 class="mb-2 text-lg font-medium text-gray-300">
            No Commit Selected
        </h3>
        <p class="text-sm text-gray-400">
            Click a commit to see its details, or select several to review them
            together.
        </p>
    </div>
{/if}
