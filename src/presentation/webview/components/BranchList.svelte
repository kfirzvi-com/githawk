<script lang="ts">
    import type { Branch } from '../../../domain/models/Branch';

    interface Props {
        branches: Branch[];
        onSwitchBranch?: (name: string) => void;
        onCheckoutRemote?: (name: string) => void;
    }

    let { branches, onSwitchBranch, onCheckoutRemote }: Props = $props();

    let filter = $state('');

    // Real repositories routinely carry dozens of branches, which makes an
    // unfiltered list unscannable. Current branch is always kept visible.
    const matching = $derived(
        filter.trim().length === 0
            ? branches
            : branches.filter(
                  (b) =>
                      b.isCurrent ||
                      b.name.toLowerCase().includes(filter.trim().toLowerCase())
              )
    );

    const localBranches = $derived(matching.filter((b) => b.isLocal));
    const remoteBranches = $derived(matching.filter((b) => b.isRemote));
    const hiddenCount = $derived(branches.length - matching.length);
</script>

<div class="flex h-full flex-col overflow-hidden bg-gray-850">
    <div class="space-y-2 border-b border-gray-700 px-4 py-3">
        <div class="flex items-baseline justify-between gap-2">
            <h2
                class="text-sm font-semibold tracking-wide text-gray-200 uppercase"
            >
                Branches
            </h2>
            <span class="text-xs tabular-nums text-gray-500">
                {branches.length}
            </span>
        </div>
        {#if branches.length > 8}
            <input
                type="search"
                bind:value={filter}
                placeholder="Filter branches…"
                aria-label="Filter branches"
                class="w-full rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            />
        {/if}
    </div>

    <div class="flex-1 overflow-y-auto">
        <div class="px-2 py-3">
            <div class="mb-2 flex items-center gap-2 px-2 py-1">
                <div class="h-2 w-2 rounded-full bg-green-400"></div>
                <span
                    class="text-xs font-medium tracking-wider text-gray-300 uppercase"
                >
                    Local
                </span>
            </div>

            <div class="space-y-1">
                {#each localBranches as branch (branch.name)}
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 {branch.isCurrent
                            ? 'border border-blue-500/30 bg-blue-600/20 text-blue-200'
                            : 'text-gray-300 hover:bg-gray-700'}"
                        onclick={() => onSwitchBranch?.(branch.name)}
                    >
                        <span
                            class="text-sm {branch.isCurrent
                                ? 'text-yellow-400'
                                : 'text-gray-500'}"
                        >
                            {branch.isCurrent ? '★' : '○'}
                        </span>
                        <span class="flex-1 truncate text-sm font-medium">
                            {branch.name}
                        </span>
                        {#if branch.isCurrent}
                            <span
                                class="rounded bg-blue-600/30 px-2 py-0.5 text-xs text-blue-300"
                            >
                                current
                            </span>
                        {/if}
                    </button>
                {/each}
                {#if localBranches.length === 0}
                    <p class="px-3 py-2 text-xs text-gray-500 italic">
                        No local branches match.
                    </p>
                {/if}
            </div>
        </div>

        {#if remoteBranches.length > 0}
            <div class="border-t border-gray-700 px-2 py-3">
                <div class="mb-2 flex items-center gap-2 px-2 py-1">
                    <div class="h-2 w-2 rounded-full bg-orange-400"></div>
                    <span
                        class="text-xs font-medium tracking-wider text-gray-300 uppercase"
                    >
                        Remote
                    </span>
                </div>

                <div class="space-y-1">
                    {#each remoteBranches as branch (branch.name)}
                        <button
                            type="button"
                            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-gray-300 transition-colors duration-150 hover:bg-gray-700"
                            onclick={() => onCheckoutRemote?.(branch.name)}
                        >
                            <span class="text-sm text-orange-400">◊</span>
                            <span class="flex-1 truncate text-sm">
                                {branch.name}
                            </span>
                        </button>
                    {/each}
                </div>
            </div>
        {/if}

        {#if hiddenCount > 0}
            <p
                class="border-t border-gray-700 px-4 py-2 text-xs text-gray-500 italic"
            >
                {hiddenCount} hidden by filter
            </p>
        {/if}
    </div>
</div>
