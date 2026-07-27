<script lang="ts">
    import type { Commit } from '../../../domain/models/Commit';
    import RefBadge from './RefBadge.svelte';

    interface Props {
        selectedCommit?: Commit | null;
    }

    let { selectedCommit = null }: Props = $props();

    const shortHash = (hash: string) => hash.slice(0, 8);
</script>

<div class="flex h-full flex-col overflow-hidden bg-gray-850">
    {#if selectedCommit}
        <div class="border-b border-gray-700 px-4 py-3">
            <h2
                class="text-sm font-semibold tracking-wide text-gray-200 uppercase"
            >
                Commit Details
            </h2>
        </div>

        <div class="flex-1 space-y-6 overflow-y-auto p-4">
            <div class="space-y-2">
                <span
                    class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                >
                    Hash
                </span>
                <div
                    class="rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                    <code class="font-mono text-sm break-all text-blue-300">
                        {selectedCommit.hash}
                    </code>
                </div>
            </div>

            <div class="space-y-2">
                <span
                    class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                >
                    Message
                </span>
                <div
                    class="rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                    <p class="text-sm leading-relaxed text-gray-200">
                        {selectedCommit.message}
                    </p>
                </div>
            </div>

            <div class="space-y-2">
                <span
                    class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                >
                    Author
                </span>
                <div
                    class="flex items-center gap-3 rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                    <div
                        class="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600"
                    >
                        <span class="text-sm font-medium text-white">
                            {(selectedCommit.author || 'U')
                                .charAt(0)
                                .toUpperCase()}
                        </span>
                    </div>
                    <span class="text-sm text-gray-200">
                        {selectedCommit.author || 'Unknown'}
                    </span>
                </div>
            </div>

            <div class="space-y-2">
                <span
                    class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                >
                    Date
                </span>
                <div
                    class="rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                    <span class="text-sm text-gray-200">
                        {selectedCommit.timestamp.toLocaleString()}
                    </span>
                </div>
            </div>

            <div class="space-y-2">
                <span
                    class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                >
                    Parents
                </span>
                <div
                    class="rounded-md border border-gray-700 bg-gray-800 p-3"
                >
                    {#if selectedCommit.parentHashes.length > 0}
                        <div class="flex flex-wrap gap-2">
                            {#each selectedCommit.parentHashes as parent (parent)}
                                <span
                                    class="rounded bg-gray-700 px-2 py-1 font-mono text-xs text-gray-300"
                                >
                                    {shortHash(parent)}
                                </span>
                            {/each}
                        </div>
                    {:else}
                        <span class="text-sm text-gray-400 italic">
                            No parents (root commit)
                        </span>
                    {/if}
                </div>
            </div>

            {#if selectedCommit.refs.length > 0}
                <div class="space-y-2">
                    <span
                        class="text-xs font-medium tracking-wider text-gray-400 uppercase"
                    >
                        References
                    </span>
                    <div
                        class="rounded-md border border-gray-700 bg-gray-800 p-3"
                    >
                        <div class="flex flex-wrap gap-2">
                            {#each selectedCommit.sortedRefs as ref (ref.kind + ref.name)}
                                <RefBadge {ref} />
                            {/each}
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    {:else}
        <div
            class="flex h-full flex-col items-center justify-center p-8 text-center"
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
                Click on a commit to view its details
            </p>
        </div>
    {/if}
</div>
