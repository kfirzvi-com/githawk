<script lang="ts">
    import type { Commit } from '../../../domain/models/Commit';
    import type { ComparisonTotals } from '../../../domain/models/FileChange';
    import RefBadge from './RefBadge.svelte';

    interface Props {
        selectedCommit?: Commit | null;
        /** What this commit changed, once the host has worked it out. */
        totals?: ComparisonTotals;
        onCopyHash?: (hash: string) => void;
        onSelectParent?: (hash: string) => void;
    }

    let {
        selectedCommit = null,
        totals = undefined,
        onCopyHash,
        onSelectParent,
    }: Props = $props();

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
            class="flex flex-shrink-0 items-baseline justify-between gap-2 border-b border-line px-4 py-3"
        >
            <h2
                class="text-sm font-semibold tracking-wide text-fg-soft uppercase"
            >
                Commit
            </h2>
            <span class="flex items-center gap-2 text-[11px] text-fg-faint">
                {#if selectedCommit.isMergeCommit}
                    <span
                        class="rounded border border-special/30 bg-special/15 px-1.5 py-0.5 text-special"
                    >
                        merge
                    </span>
                {/if}
                {#if selectedCommit.isRootCommit}
                    <span
                        class="rounded border border-line-strong bg-control/50 px-1.5 py-0.5 text-fg-muted"
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
                    class="text-sm leading-snug font-semibold text-fg"
                    style="overflow-wrap:anywhere;"
                >
                    {selectedCommit.subject || '(no message)'}
                </p>
                {#if selectedCommit.hasBody}
                    <!-- Preserves the author's own line breaks and indentation,
                         which carry meaning in bullet lists and trailers. -->
                    <pre
                        class="font-sans text-xs leading-relaxed whitespace-pre-wrap text-fg-muted"
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

            {#if totals}
                <!-- The files themselves are in the Changes tree; this is the
                     shape of the change, next to the message that explains it. -->
                <div
                    class="flex items-baseline gap-3 border-t border-line/70 pt-4 text-xs tabular-nums"
                >
                    <span class="text-fg-soft">
                        {`${totals.files} ${
                            totals.files === 1 ? 'file changed' : 'files changed'
                        }`}
                    </span>
                    <span class="text-ok">+{totals.insertions}</span>
                    <span class="text-danger">−{totals.deletions}</span>
                    {#if totals.binaryFiles > 0}
                        <span class="text-fg-faint">
                            {`${totals.binaryFiles} binary`}
                        </span>
                    {/if}
                </div>
            {/if}

            <div class="space-y-3 border-t border-line/70 pt-4">
                <div class="flex items-center gap-3">
                    <div
                        class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-info-strong to-special text-sm font-medium text-on-accent"
                    >
                        {initial}
                    </div>
                    <div class="min-w-0">
                        <p class="truncate text-sm text-fg-soft">
                            {selectedCommit.author || 'Unknown'}
                        </p>
                        {#if selectedCommit.authorEmail}
                            <p class="truncate text-[11px] text-fg-faint">
                                {selectedCommit.authorEmail}
                            </p>
                        {/if}
                    </div>
                </div>

                <div class="space-y-1">
                    <p class="text-xs text-fg-muted">
                        {relative(selectedCommit.timestamp)}
                    </p>
                    <p class="text-[11px] text-fg-faint">
                        {absolute(selectedCommit.timestamp)}
                    </p>
                </div>

                {#if selectedCommit.wasRewritten}
                    <!-- Only shown when it differs, because an identical
                         committer is noise. When it differs it is the explanation
                         for a date that otherwise looks wrong. -->
                    <div
                        class="rounded border border-line bg-graph/60 px-2 py-1.5 text-[11px] text-fg-dim"
                    >
                        <p class="text-fg-muted">Committed separately</p>
                        {#if selectedCommit.committer && selectedCommit.committer !== selectedCommit.author}
                            <p>by {selectedCommit.committer}</p>
                        {/if}
                        {#if selectedCommit.committedAt}
                            <p>{absolute(selectedCommit.committedAt)}</p>
                        {/if}
                        <p class="mt-1 text-fg-faint italic">
                            Typical of a rebase, cherry-pick, or applied patch.
                        </p>
                    </div>
                {/if}
            </div>

            <div class="space-y-1.5 border-t border-line/70 pt-4">
                <div class="flex items-center justify-between gap-2">
                    <span
                        class="text-[11px] font-medium tracking-wider text-fg-faint uppercase"
                    >
                        Commit hash
                    </span>
                    <button
                        type="button"
                        class="text-[11px] text-fg-dim underline hover:text-fg-soft"
                        onclick={() => onCopyHash?.(selectedCommit.hash)}
                    >
                        Copy
                    </button>
                </div>
                <code
                    class="block rounded border border-line bg-graph p-2 font-mono text-[11px] break-all text-info"
                >
                    {selectedCommit.hash}
                </code>
            </div>

            <div class="space-y-1.5 border-t border-line/70 pt-4">
                <span
                    class="text-[11px] font-medium tracking-wider text-fg-faint uppercase"
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
                                class="rounded bg-control px-2 py-1 font-mono text-[11px] text-fg-muted hover:bg-control-hover hover:text-fg"
                                title={`Select ${parent}`}
                                onclick={() => onSelectParent?.(parent)}
                            >
                                {parent.slice(0, 8)}
                            </button>
                        {/each}
                    </div>
                {:else}
                    <p class="text-xs text-fg-faint italic">
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
            class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-control"
        >
            <svg
                class="h-8 w-8 text-fg-dim"
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
        <h3 class="mb-2 text-lg font-medium text-fg-muted">
            No Commit Selected
        </h3>
        <p class="text-sm text-fg-dim">
            Click a commit to see its details, or select several to review them
            together.
        </p>
    </div>
{/if}
