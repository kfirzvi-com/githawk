<script lang="ts">
    import type { Branch } from '../../../domain/models/Branch';
    import type { Worktree } from '../../../domain/models/Worktree';
    import {
        mainWorktreePath,
        shortWorktreeName,
    } from '../viewmodels/worktreeLabels';

    interface Props {
        branches: Branch[];
        /** Empty until the host reports them, and in the dev harness. */
        worktrees?: Worktree[];
        /** Opens the native action menu; checkout is one item within it. */
        onOpenMenu?: (branch: Branch) => void;
        /** No path opens the manager; a path opens that worktree's actions. */
        onOpenWorktreeMenu?: (path?: string) => void;
    }

    let {
        branches,
        worktrees = [],
        onOpenMenu,
        onOpenWorktreeMenu,
    }: Props = $props();

    let filter = $state('');

    /*
     * Only shown once there is more than one, because a repository with a single
     * worktree has nothing to say here — every repository has one.
     */
    const showWorktrees = $derived(worktrees.length > 1);
    const staleWorktrees = $derived(worktrees.filter((w) => w.isPrunable).length);
    /** Everything else is labelled relative to the repository's own directory. */
    const mainPath = $derived(mainWorktreePath(worktrees));

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

<div
    class="flex h-full flex-col overflow-hidden bg-gray-850"
    data-testid="branch-list"
>
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
                        onclick={() => onOpenMenu?.(branch)}
                    >
                        <span
                            class="text-sm {branch.isCurrent
                                ? 'text-yellow-400'
                                : 'text-gray-500'}"
                        >
                            {branch.isCurrent ? '★' : '○'}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-sm font-medium">
                            {branch.name}
                        </span>
                        <!-- Ahead/behind at a glance: which branches need
                             updating is the question this list is asked most. -->
                        {#if branch.upstream?.isGone}
                            <span
                                class="flex-shrink-0 text-[11px] text-amber-400"
                                title={`${branch.upstream.name} no longer exists on the remote`}
                            >
                                gone
                            </span>
                        {:else if branch.isAhead || branch.isBehind}
                            <span
                                class="flex-shrink-0 text-[11px] tabular-nums"
                                title={`${branch.upstream?.ahead ?? 0} ahead, ${
                                    branch.upstream?.behind ?? 0
                                } behind ${branch.upstream?.name ?? 'upstream'}`}
                            >
                                {#if branch.isBehind}
                                    <span class="text-blue-300">
                                        ↓{branch.upstream?.behind}
                                    </span>
                                {/if}
                                {#if branch.isAhead}
                                    <span class="text-green-300">
                                        ↑{branch.upstream?.ahead}
                                    </span>
                                {/if}
                            </span>
                        {/if}
                        <!-- A branch lives in one working tree at a time, so this
                             is the reason a checkout would be refused. Saying it
                             here is cheaper than finding out from git. -->
                        {#if branch.isCheckedOutElsewhere && branch.worktreePath}
                            <span
                                class="flex-shrink-0 rounded bg-purple-600/25 px-1.5 py-0.5 text-[10px] text-purple-200"
                                title={`Checked out in the worktree ${branch.worktreePath}, so it cannot be checked out here`}
                            >
                                ⧉ {shortWorktreeName(
                                    branch.worktreePath,
                                    mainPath
                                )}
                            </span>
                        {/if}
                        {#if branch.isCurrent}
                            <span
                                class="flex-shrink-0 rounded bg-blue-600/30 px-2 py-0.5 text-xs text-blue-300"
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
                            onclick={() => onOpenMenu?.(branch)}
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

        {#if showWorktrees}
            <div
                class="border-t border-gray-700 px-2 py-3"
                data-testid="worktree-list"
            >
                <div class="mb-2 flex items-center gap-2 px-2 py-1">
                    <div class="h-2 w-2 rounded-full bg-purple-400"></div>
                    <span
                        class="text-xs font-medium tracking-wider text-gray-300 uppercase"
                    >
                        Worktrees
                    </span>
                    <div class="flex-1"></div>
                    <button
                        type="button"
                        data-testid="manage-worktrees"
                        class="rounded px-1.5 py-0.5 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        onclick={() => onOpenWorktreeMenu?.()}
                        title="Create, open, or remove a worktree"
                    >
                        Manage
                    </button>
                </div>

                <div class="space-y-1">
                    {#each worktrees as worktree (worktree.path)}
                        <button
                            type="button"
                            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 {worktree.isCurrent
                                ? 'border border-purple-500/30 bg-purple-600/15 text-purple-100'
                                : 'text-gray-300 hover:bg-gray-700'}"
                            onclick={() => onOpenWorktreeMenu?.(worktree.path)}
                            title={worktree.path}
                        >
                            <span
                                class="text-sm {worktree.isCurrent
                                    ? 'text-purple-300'
                                    : 'text-gray-500'}"
                            >
                                ⧉
                            </span>
                            <span
                                class="min-w-0 flex-1 truncate text-sm font-medium"
                            >
                                {shortWorktreeName(worktree.path, mainPath)}
                            </span>
                            <span
                                class="max-w-[7rem] flex-shrink-0 truncate text-[11px] text-gray-400"
                            >
                                {worktree.checkedOut}
                            </span>
                            <!-- A missing directory is why git keeps refusing
                                 the branch, so it is the one state worth
                                 shouting about. -->
                            {#if worktree.isPrunable}
                                <span
                                    class="flex-shrink-0 text-[10px] text-amber-400"
                                    title={worktree.prunableReason ??
                                        'git cannot find this directory'}
                                >
                                    missing
                                </span>
                            {:else if worktree.isLocked}
                                <span
                                    class="flex-shrink-0 text-[10px] text-gray-400"
                                    title={worktree.lockReason ?? 'locked'}
                                >
                                    locked
                                </span>
                            {/if}
                        </button>
                    {/each}
                </div>

                {#if staleWorktrees > 0}
                    <p class="px-3 pt-2 text-[11px] text-amber-400/80">
                        {staleWorktrees} record(s) point at directories that are
                        gone — prune them from Manage.
                    </p>
                {/if}
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
