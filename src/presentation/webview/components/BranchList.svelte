<script lang="ts">
    import type { Branch } from '../../../domain/models/Branch';
    import type { Worktree } from '../../../domain/models/Worktree';
    import type { Stash } from '../../../domain/models/Stash';
    import {
        mainWorktreePath,
        shortWorktreeName,
    } from '../viewmodels/worktreeLabels';
    import SectionHeader from './SectionHeader.svelte';
    import {
        readSections,
        withSection,
        type Section,
    } from '../viewmodels/sections';
    import { readWebviewState, writeWebviewState } from '../vscodeApi';

    interface Props {
        branches: Branch[];
        /** Empty until the host reports them, and in the dev harness. */
        worktrees?: Worktree[];
        /** Opens the native action menu; checkout is one item within it. */
        onOpenMenu?: (branch: Branch) => void;
        /** No path opens the manager; a path opens that worktree's actions. */
        onOpenWorktreeMenu?: (path?: string) => void;
        /** Empty until the host reports them, and in the dev harness. */
        stashes?: Stash[];
        /** No ref opens the manager; a ref opens that entry's actions. */
        onOpenStashMenu?: (ref?: string) => void;
    }

    let {
        branches,
        worktrees = [],
        onOpenMenu,
        onOpenWorktreeMenu,
        stashes = [],
        onOpenStashMenu,
    }: Props = $props();

    let filter = $state('');

    /** Persisted, so a section folded away stays folded across a reload. */
    const SECTIONS_STATE_KEY = 'branchListSections';
    let sections = $state(readSections(readWebviewState(SECTIONS_STATE_KEY)));

    const toggleSection = (section: Section) => {
        sections = withSection(sections, section, !sections[section]);
        writeWebviewState(SECTIONS_STATE_KEY, sections);
    };

    /**
     * Every repository has one working tree, so a single entry says nothing —
     * but a section that is missing says less. It is shown either way, because
     * a feature nobody can see is a feature nobody uses; the empty state is
     * where it explains itself.
     */
    const otherWorktrees = $derived(Math.max(0, worktrees.length - 1));
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
    class="flex h-full flex-col overflow-hidden bg-pane"
    data-testid="branch-list"
>
    <div class="space-y-2 border-b border-line px-4 py-3">
        <div class="flex items-baseline justify-between gap-2">
            <h2
                class="text-sm font-semibold tracking-wide text-fg-soft uppercase"
            >
                Branches
            </h2>
            <span class="text-xs tabular-nums text-fg-faint">
                {branches.length}
            </span>
        </div>
        <!-- Always, not past a threshold. It used to appear above eight
             branches, which made it look like a feature that came and went:
             the one repository where you go looking for it is the one you have
             just cloned. -->
        <input
            type="search"
            bind:value={filter}
            placeholder="Filter branches…"
            aria-label="Filter branches"
            class="w-full rounded-md border border-line bg-graph px-2 py-1 text-xs text-fg-soft placeholder:text-fg-faint focus:border-info-strong focus:outline-none"
        />
    </div>

    <div class="flex-1 overflow-y-auto">
        <div class="px-2 py-3">
            <SectionHeader
                section="local"
                label="Local"
                count={localBranches.length}
                dot="bg-ok"
                open={sections.local}
                onToggle={toggleSection}
            />

            <div class="space-y-1" hidden={!sections.local}>
                {#each localBranches as branch (branch.name)}
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 {branch.isCurrent
                            ? 'border border-info-strong/30 bg-selected text-info'
                            : 'text-fg-muted hover:bg-control'}"
                        onclick={() => onOpenMenu?.(branch)}
                    >
                        <span
                            class="text-sm {branch.isCurrent
                                ? 'text-yellow-400'
                                : 'text-fg-faint'}"
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
                                class="flex-shrink-0 text-[11px] text-warn"
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
                                    <span class="text-info">
                                        ↓{branch.upstream?.behind}
                                    </span>
                                {/if}
                                {#if branch.isAhead}
                                    <span class="text-ok">
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
                                class="flex-shrink-0 rounded bg-special/25 px-1.5 py-0.5 text-[10px] text-special"
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
                                class="flex-shrink-0 rounded bg-accent/30 px-2 py-0.5 text-xs text-info"
                            >
                                current
                            </span>
                        {/if}
                    </button>
                {/each}
                {#if localBranches.length === 0}
                    <p class="px-3 py-2 text-xs text-fg-faint italic">
                        No local branches match.
                    </p>
                {/if}
            </div>
        </div>

        {#if remoteBranches.length > 0}
            <div class="border-t border-line px-2 py-3">
                <SectionHeader
                    section="remote"
                    label="Remote"
                    count={remoteBranches.length}
                    dot="bg-warn"
                    open={sections.remote}
                    onToggle={toggleSection}
                />

                <div class="space-y-1" hidden={!sections.remote}>
                    {#each remoteBranches as branch (branch.name)}
                        <button
                            type="button"
                            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-fg-muted transition-colors duration-150 hover:bg-control"
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

        <div
            class="border-t border-line px-2 py-3"
            data-testid="worktree-list"
        >
            <div class="flex items-center gap-1">
                <div class="min-w-0 flex-1">
                    <SectionHeader
                        section="worktrees"
                        label="Worktrees"
                        count={worktrees.length}
                        dot="bg-special"
                        open={sections.worktrees}
                        onToggle={toggleSection}
                    />
                </div>
                <button
                    type="button"
                    data-testid="manage-worktrees"
                    class="rounded px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-control hover:text-fg-soft"
                    onclick={() => onOpenWorktreeMenu?.()}
                    title="Create, open, or remove a worktree"
                >
                    Manage
                </button>
            </div>

            <div class="space-y-1" hidden={!sections.worktrees}>
                {#each worktrees as worktree (worktree.path)}
                    <button
                        type="button"
                        class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150 {worktree.isCurrent
                            ? 'border border-special/30 bg-special/15 text-special'
                            : 'text-fg-muted hover:bg-control'}"
                        onclick={() => onOpenWorktreeMenu?.(worktree.path)}
                        title={worktree.path}
                    >
                        <span
                            class="text-sm {worktree.isCurrent
                                ? 'text-special'
                                : 'text-fg-faint'}"
                        >
                            ⧉
                        </span>
                        <span
                            class="min-w-0 flex-1 truncate text-sm font-medium"
                        >
                            {shortWorktreeName(worktree.path, mainPath)}
                        </span>
                        <span
                            class="max-w-[7rem] flex-shrink-0 truncate text-[11px] text-fg-dim"
                        >
                            {worktree.checkedOut}
                        </span>
                        <!-- A missing directory is why git keeps refusing
                             the branch, so it is the one state worth
                             shouting about. -->
                        {#if worktree.isPrunable}
                            <span
                                class="flex-shrink-0 text-[10px] text-warn"
                                title={worktree.prunableReason ??
                                    'git cannot find this directory'}
                            >
                                missing
                            </span>
                        {:else if worktree.isLocked}
                            <span
                                class="flex-shrink-0 text-[10px] text-fg-dim"
                                title={worktree.lockReason ?? 'locked'}
                            >
                                locked
                            </span>
                        {/if}
                    </button>
                {/each}
            </div>

            {#if sections.worktrees}
                {#if staleWorktrees > 0}
                    <p class="px-3 pt-2 text-[11px] text-warn/80">
                        {staleWorktrees} record(s) point at directories that are
                        gone — prune them from Manage.
                    </p>
                {:else if otherWorktrees === 0}
                    <!-- One entry is the repository itself, which says nothing
                         on its own — so the section says what the feature is
                         for instead. -->
                    <p class="px-3 pt-2 text-[11px] text-fg-faint">
                        Only this working tree. A branch's menu can check one out
                        into its own directory.
                    </p>
                {/if}
            {/if}
        </div>

        <div class="border-t border-line px-2 py-3" data-testid="stash-list">
                <div class="flex items-center gap-1">
                    <div class="min-w-0 flex-1">
                        <SectionHeader
                            section="stashes"
                            label="Stashes"
                            count={stashes.length}
                            dot="bg-warn"
                            open={sections.stashes}
                            onToggle={toggleSection}
                        />
                    </div>
                    <button
                        type="button"
                        data-testid="manage-stashes"
                        class="rounded px-1.5 py-0.5 text-[10px] text-fg-dim hover:bg-control hover:text-fg-soft"
                        onclick={() => onOpenStashMenu?.()}
                        title="Stash the working tree, or act on an entry"
                    >
                        Manage
                    </button>
                </div>

                <div class="space-y-1" hidden={!sections.stashes}>
                    {#each stashes as stash (stash.hash)}
                        <button
                            type="button"
                            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-fg-muted transition-colors duration-150 hover:bg-control"
                            onclick={() => onOpenStashMenu?.(stash.ref)}
                            title={`${stash.ref} — on ${stash.branch}, ${stash.createdAt.toLocaleString()}`}
                        >
                            <!-- Half-height bar, matching the badge the graph
                                 draws on the same entry. -->
                            <span
                                aria-hidden="true"
                                class="h-1 w-2 flex-shrink-0 rounded-[1px] bg-warn"
                            ></span>
                            <span
                                class="min-w-0 flex-1 truncate text-sm {stash.isAutoNamed
                                    ? 'italic'
                                    : ''}"
                            >
                                {stash.message}
                            </span>
                            <span
                                class="flex-shrink-0 text-[10px] text-fg-faint"
                            >
                                {stash.branch}
                            </span>
                        </button>
                    {/each}

                    {#if stashes.length === 0}
                        <!-- Nothing is stashed, which is worth saying rather
                             than showing nothing: the section is how anyone
                             finds out the stash is here at all. -->
                        <p class="px-3 py-1 text-[11px] text-fg-faint">
                            Nothing stashed. Manage puts the working tree aside.
                        </p>
                    {/if}
                </div>
        </div>

        {#if hiddenCount > 0}
            <p
                class="border-t border-line px-4 py-2 text-xs text-fg-faint italic"
            >
                {hiddenCount} hidden by filter
            </p>
        {/if}
    </div>
</div>
