<script lang="ts">
    import type { Branch } from '../../domain/models/Branch';
    import type { Commit } from '../../domain/models/Commit';
    import type { Worktree } from '../../domain/models/Worktree';
    import { isBranchRef, type Ref } from '../../domain/models/Ref';
    import { GraphLayoutService } from '../../domain/services/GraphLayoutService';
    import {
        BranchMapper,
        CommitMapper,
        StashMapper,
        WorktreeMapper,
    } from '../../application/dto/mappers';
    import type { Stash } from '../../domain/models/Stash';
    import BranchList from './components/BranchList.svelte';
    import CommitDetails from './components/CommitDetails.svelte';
    import GitGraph from './components/GitGraph.svelte';
    import RefBadge from './components/RefBadge.svelte';
    import type { ComparisonDto } from '../../application/dto/ComparisonDto';
    import type { RepositoryLocation } from '../../domain/models/RepositoryLocation';
    import ComparisonSummary from './components/ComparisonSummary.svelte';
    import {
        applySelection,
        emptySelection,
        isContiguous,
        type SelectModifiers,
        type SelectionState,
    } from './viewmodels/selection';
    import Toolbar from './components/Toolbar.svelte';
    import ShortcutHint from './components/ShortcutHint.svelte';
    import type { ToolbarAction } from './viewmodels/toolbar';
    import { anchorAt, scrollTopFor } from './viewmodels/scrollAnchor';
    import {
        defaultMetrics,
        graphWidth,
    } from './viewmodels/graphGeometry';
    import {
        commitTimestamp,
        commitTimestampTooltip,
    } from './viewmodels/commitTimestamp';
    import { tick } from 'svelte';
    import PaneHandle from './components/PaneHandle.svelte';
    import WorkingTreeRow from './components/WorkingTreeRow.svelte';
    import {
        cleanWorkingTree,
        isClean,
        type WorkingTreeStatus,
    } from '../../domain/models/WorkingTreeStatus';
    import {
        readPaneVisibility,
        withPane,
        type Pane,
    } from './viewmodels/panes';
    import {
        onHostMessage,
        postToHost,
        readWebviewState,
        writeWebviewState,
    } from './vscodeApi';
    import {
        availableShortcuts,
        isTextFieldTarget,
        resolveShortcut,
        shortcutKey,
        type ShortcutAction,
    } from './viewmodels/shortcuts';
    import {
        WORKING_TREE_ROW,
        initialCursor,
        isMove,
        keyboardRows,
        moveCursor,
        type GraphKeyAction,
    } from './viewmodels/graphKeys';

    /** Persisted, so folding a pane away survives the panel being rebuilt. */
    const PANES_STATE_KEY = 'panes';

    const layoutService = new GraphLayoutService();

    let commits = $state<Commit[]>([]);
    let branches = $state<Branch[]>([]);
    let selectedCommit = $state<Commit | null>(null);
    let errorMessage = $state<string | null>(null);
    let isLoading = $state(true);
    let hasMoreHistory = $state(false);
    let primaryBranchName = $state<string | undefined>(undefined);
    let selection = $state<SelectionState>(emptySelection);
    /** Files live in the Changes tree; this is kept only for the summary line. */
    let comparison = $state<ComparisonDto | null>(null);
    /** Empty until the host has scanned the workspace, and in the dev harness. */
    let repositories = $state<RepositoryLocation[]>([]);
    let activeRepositoryRoot = $state<string | undefined>(undefined);
    /** Working trees of the active repository. One is the common case. */
    let worktrees = $state<Worktree[]>([]);
    /** Listed in the sidebar; the same entries are rows in the graph. */
    let stashes = $state<Stash[]>([]);
    /** The graph's scroll container, so a reload can keep the reader's place. */
    let graphScroller = $state<HTMLDivElement | null>(null);
    let panes = $state(readPaneVisibility(readWebviewState(PANES_STATE_KEY)));
    /** Counts only; the files themselves go to the Changes tree as usual. */
    let workingTree = $state<WorkingTreeStatus>(cleanWorkingTree);
    let workingTreeSelected = $state(false);
    /** Shift is being held, so every control with a key is showing it. */
    let shortcutHintsShown = $state(false);
    /** The three that act on the graph as a whole, in the order they are used. */
    const graphKeyLegend = $derived(
        (
            [
                { action: 'focusGraph', label: 'put the cursor here' },
                { action: 'selectionMode', label: 'pick commits' },
                { action: 'showSelectionChanges', label: 'show the changes' },
            ] as const
        ).filter((entry) => liveShortcuts.has(entry.action))
    );
    /** Bound so Shift+K can put the caret in a field it does not own. */
    let branchList = $state<BranchList | null>(null);
    /**
     * The row the keyboard is on. Deliberately not the selection: the cursor
     * moves freely and costs nothing, and only Enter or Space commits to a
     * comparison — arrowing through two hundred commits should not ask the host
     * two hundred questions.
     */
    let cursorHash = $state<string | null>(null);
    /** Space picks rather than clicks. Entered with Shift+V, left with Escape. */
    let selecting = $state(false);
    /** A reveal that named a commit the graph had not been sent yet. */
    let pendingReveal = $state<string | null>(null);

    /** Layout is derived, never stored: one source of truth for the graph. */
    const graph = $derived(
        commits.length > 0
            ? layoutService.layout(commits, { primaryBranchName })
            : null
    );
    const currentBranchName = $derived(
        branches.find((b) => b.isCurrent)?.name ?? null
    );
    const rowOrder = $derived(graph?.commits.map((c) => c.hash) ?? []);
    const workingTreeIsClean = $derived(isClean(workingTree));
    /**
     * What the arrows walk. The commits, plus the uncommitted row at the top
     * when there is one: a cursor that stopped at the newest commit with a
     * row visibly above it was a cursor that could not reach the one row a
     * reader about to commit most wants.
     */
    const cursorRows = $derived(keyboardRows(rowOrder, !workingTreeIsClean));
    const cursorOnWorkingTree = $derived(
        cursorHash === WORKING_TREE_ROW && !workingTreeIsClean
    );
    /**
     * The working-tree row shares the graph's scroll container and sits above
     * row 0, so every commit is that much further down than its index says.
     * Scroll anchoring maps pixels to rows arithmetically — rows are a fixed
     * height, which is what makes it cheap — so it has to be told.
     */
    const graphScrollOffset = $derived(
        workingTreeIsClean ? 0 : defaultMetrics.rowH
    );
    /**
     * The same width GitGraph reserves for its lanes, computed the same way, so
     * the working-tree marker sits above the commit dots rather than beside
     * them. The row cannot live inside GitGraph: that component maps rows to
     * pixels by index, and a row that is not a commit would shift every node
     * off its edge.
     */
    const graphGutterWidth = $derived(
        graph
            ? graphWidth(
                  graph.nodes.reduce((max, node) => Math.max(max, node.lane), 0),
                  defaultMetrics
              )
            : 0
    );
    const selectedHashes = $derived(new Set(selection.hashes));
    const selectionIsContiguous = $derived(
        isContiguous(rowOrder, selection.hashes)
    );
    /**
     * One list decides both which badges are drawn and which keys do anything,
     * because a badge is a promise that the key works. Two lists would drift,
     * and both ways of drifting are silent: a badge on a dead key, or a working
     * key nobody can find.
     */
    const liveShortcuts = $derived(
        availableShortcuts({
            panelReady: !isLoading && errorMessage === null,
            hasRepositories: repositories.length > 0,
            branchesPaneVisible: panes.branches,
            selectionCount: selection.hashes.length,
            commitCount: commits.length,
        })
    );
    /**
     * A single commit still runs a comparison — that is what fills the Changes
     * tree — but its details belong in this panel, not a one-file summary. Only a
     * genuine aggregate (a selection, a branch review, a two-ref diff) replaces
     * them. Keying on the method rather than on the selection covers comparisons
     * that did not come from the graph at all.
     */
    const showAggregate = $derived(
        comparison !== null && comparison.method !== 'singleCommit'
    );

    /** Stats for the selected commit, shown alongside its details. */
    const selectedCommitTotals = $derived(
        comparison && comparison.method === 'singleCommit'
            ? comparison.totals
            : undefined
    );

    /** The selected commits themselves, so the summary can list them. */
    const selectedCommits = $derived(
        graph
            ? graph.commits.filter((commit) =>
                  selectedHashes.has(commit.hash)
              )
            : []
    );

    $effect(() =>
        onHostMessage((message) => {
            switch (message.type) {
                case 'graph:loaded': {
                    // Captured before the rows change, restored after. A reload
                    // the reader did not ask for must not move the page under
                    // them, and a new commit arrives at the top of the list.
                    const anchor = anchorAt(
                        (graphScroller?.scrollTop ?? 0) - graphScrollOffset,
                        defaultMetrics.rowH,
                        rowOrder
                    );

                    commits = message.graph.commits.map(CommitMapper.fromDto);
                    branches = message.graph.branches.map(BranchMapper.fromDto);
                    stashes = message.graph.stashes.map(StashMapper.fromDto);
                    hasMoreHistory = message.graph.hasMoreHistory;
                    primaryBranchName = message.graph.primaryBranchName;
                    errorMessage = null;
                    isLoading = false;

                    dropVanishedCommitsFromSelection();
                    // Before the scroll is restored: a held reveal is a request
                    // to look somewhere else, and restoring the old position
                    // afterwards would undo it.
                    if (pendingReveal && revealInGraph(pendingReveal)) {
                        pendingReveal = null;
                        break;
                    }
                    if (anchor) {
                        void restoreScroll(anchor);
                    }
                    break;
                }
                case 'graph:error':
                    errorMessage = message.message;
                    isLoading = false;
                    break;
                case 'comparison:loaded':
                    comparison = message.comparison;
                    break;
                case 'comparison:cleared':
                    comparison = null;
                    break;
                case 'repositories:loaded':
                    if (message.activeRoot !== activeRepositoryRoot) {
                        // Hashes belong to a repository. Carrying a selection
                        // across a switch would ask the new one about commits
                        // it has never heard of.
                        selection = emptySelection;
                        selectedCommit = null;
                        comparison = null;
                        isLoading = true;
                    }
                    repositories = message.repositories;
                    activeRepositoryRoot = message.activeRoot;
                    break;
                case 'worktrees:loaded':
                    worktrees = message.worktrees.map(WorktreeMapper.fromDto);
                    break;
                case 'commit:reveal':
                    /*
                     * Arriving from a blame hover, or from the editor's own
                     * shortcut. Held rather than dropped when the commit is not
                     * in the graph yet: the command opens the panel first, and
                     * on a panel that was closed the reveal outruns the graph
                     * it names — the Changes tree filled, the graph selected
                     * nothing, and the feature looked broken.
                     */
                    if (!revealInGraph(message.hash)) {
                        pendingReveal = message.hash;
                    }
                    break;
                case 'workingTree:loaded':
                    workingTree = message.status;
                    // Committing everything removes the row; leaving it
                    // selected would keep a changeset on screen that no longer
                    // has anything in it.
                    if (isClean(message.status)) {
                        workingTreeSelected = false;
                    }
                    break;
            }
        })
    );

    /**
     * Puts the DOM focus on a commit row, which is what makes the arrow keys
     * work: the rows are buttons with a roving tabindex, so the browser's own
     * focus is the cursor rather than something drawn to look like one.
     *
     * `.focus()` scrolls the row into view by itself, and does the smallest
     * scroll that gets there — which is the right amount for a cursor stepping
     * a row at a time, and the reason this does not use `scrollCommitIntoView`.
     */
    const focusRow = async (hash: string) => {
        await tick();
        const row = graphScroller?.querySelector<HTMLElement>(
            `[data-hash="${CSS.escape(hash)}"]`
        );
        row?.focus();
    };

    /** How far Page Up and Page Down go: a screenful, minus a row to overlap. */
    const graphPageSize = () =>
        Math.max(
            1,
            Math.floor((graphScroller?.clientHeight ?? 0) / defaultMetrics.rowH) - 1
        );

    /**
     * Shift+G. Picks up where the mouse left off rather than jumping to the top,
     * so the graph a reader was already looking at stays where it is.
     */
    const focusGraph = () => {
        const hash = initialCursor(
            cursorRows,
            workingTreeSelected ? WORKING_TREE_ROW : (selectedCommit?.hash ?? null)
        );
        if (!hash) {
            return;
        }
        cursorHash = hash;
        void focusRow(hash);
    };

    /**
     * Shift+V. Entering also focuses the graph: a mode whose only key is Space
     * is useless until the keyboard is somewhere Space means something.
     */
    const enterSelectionMode = () => {
        if (rowOrder.length === 0) {
            return;
        }
        selecting = true;
        if (cursorHash === null || !cursorRows.includes(cursorHash)) {
            focusGraph();
        } else {
            void focusRow(cursorHash);
        }
    };

    const leaveSelectionMode = () => {
        selecting = false;
    };

    /**
     * Shift+A, and what confirming a set of picks runs.
     *
     * Selecting normally asks for the comparison by itself, on a debounce. This
     * is the same request without the wait, for the two cases where nothing is
     * pending: picks made in selection mode, which deliberately send nothing
     * while they are being made, and a tree the reader has scrolled away from.
     */
    const showSelectionChanges = () => {
        clearTimeout(pendingRequest);
        const hashes = [...selection.hashes];

        if (hashes.length === 0) {
            postToHost({ type: 'compare:clear' });
            return;
        }
        if (hashes.length === 1) {
            postToHost({ type: 'commit:select', hash: hashes[0] });
            return;
        }
        postToHost({ type: 'compare:commits', hashes });
    };

    /**
     * What the graph's own keys do — the arrows, Enter, Space — once a row has
     * focus. Every one of them runs the handler the mouse already runs, so a
     * keyboard and a click cannot drift apart.
     *
     * `row` is a commit hash, or the uncommitted row's key. The moves treat
     * the two alike; the rest look the commit up, and on the uncommitted row
     * do what its click does — select it — or nothing, where it has no menu
     * and cannot join a selection.
     */
    const handleGraphKey = (action: GraphKeyAction, row: string) => {
        if (isMove(action)) {
            const next = moveCursor(cursorRows, row, action, graphPageSize());
            if (next) {
                cursorHash = next;
                void focusRow(next);
            }
            return;
        }

        if (row === WORKING_TREE_ROW) {
            if (action === 'activate' || action === 'confirmSelection') {
                leaveSelectionMode();
                selectWorkingTree();
            } else if (action === 'leaveSelectionMode') {
                leaveSelectionMode();
            }
            return;
        }

        const commit = graph?.commits.find((candidate) => candidate.hash === row);
        if (!commit) {
            return;
        }

        switch (action) {
            case 'activate':
                // The left click, exactly: no modifiers, so it replaces.
                handleSelectCommit(commit, { toggle: false, range: false });
                break;
            case 'contextMenu':
                /*
                 * The right click. The mouse replaces the selection before
                 * opening the menu, and for one commit this does the same. It
                 * stops short of that for a multi-selection: a set of picks
                 * takes several presses to build, and throwing it away to read
                 * one commit's menu is not what asking for the menu meant.
                 */
                if (selection.hashes.length <= 1) {
                    handleSelectCommit(commit, { toggle: false, range: false });
                }
                postToHost({ type: 'commit:menu', hash: commit.hash });
                break;
            case 'toggleInSelection':
                // Nothing is sent while picking. The whole point of the mode is
                // to choose a set before asking anything about it.
                workingTreeSelected = false;
                selection = applySelection(selection, rowOrder, commit.hash, {
                    toggle: true,
                    range: false,
                });
                selectedCommit = commit;
                break;
            case 'confirmSelection':
                leaveSelectionMode();
                showSelectionChanges();
                break;
            case 'leaveSelectionMode':
                leaveSelectionMode();
                break;
        }
    };

    /**
     * Holding Shift reveals the badges; holding it and pressing a letter runs
     * that control. Basecamp's design, and the reason it works is that the list
     * of shortcuts is the screen itself — always accurate, and always beside
     * the thing it acts on.
     */
    let revealTimer: ReturnType<typeof setTimeout> | undefined;

    /*
     * A quarter of a second before anything appears. Shift is already a
     * modifier here — Shift+click extends a selection in the graph — and
     * without the pause every range selection makes the whole panel flash a
     * dozen badges. Nobody holding Shift to click waits this long; everybody
     * holding it to read does.
     */
    const REVEAL_DELAY_MS = 250;

    const revealHints = () => {
        if (shortcutHintsShown || revealTimer !== undefined) {
            return;
        }
        revealTimer = setTimeout(() => {
            revealTimer = undefined;
            shortcutHintsShown = true;
        }, REVEAL_DELAY_MS);
    };

    const hideHints = () => {
        clearTimeout(revealTimer);
        revealTimer = undefined;
        shortcutHintsShown = false;
    };

    /**
     * Every shortcut goes through the handler the mouse already uses, rather
     * than reaching for `postToHost` itself. A key that took its own route
     * would be a second implementation of the same button, and the debounce,
     * the loading flag and the mutual exclusion with the working-tree row all
     * live on this side of it.
     */
    const runShortcut = (action: ShortcutAction) => {
        // The badges stay up while Shift is held, so two of these can be run
        // one after the other — fold both panes away, or fetch and then pull —
        // without letting go in between.
        switch (action) {
            case 'refresh':
            case 'fetch':
            case 'pull':
            case 'push':
                handleToolbarAction(action);
                break;
            case 'switchRepository':
                postToHost({ type: 'repository:menu' });
                break;
            case 'switchBranch':
                switchBranch();
                break;
            case 'filterBranches':
                branchList?.focusFilter();
                // The caret is now in a field, where Shift means a capital and
                // no other key is a shortcut. Leaving the badges up would be
                // promising something that has just stopped being true.
                hideHints();
                break;
            case 'manageRemotes':
                postToHost({ type: 'remotes:menu' });
                break;
            case 'manageWorktrees':
                postToHost({ type: 'worktree:menu' });
                break;
            case 'manageStashes':
                postToHost({ type: 'stash:menu' });
                break;
            case 'toggleBranches':
                togglePane('branches');
                break;
            case 'toggleDetails':
                togglePane('details');
                break;
            case 'toggleMaximized':
                toggleMaximized();
                break;
            case 'focusGraph':
                focusGraph();
                break;
            case 'selectionMode':
                enterSelectionMode();
                break;
            case 'showSelectionChanges':
                showSelectionChanges();
                break;
            case 'clearSelection':
                clearSelection();
                break;
            case 'diffTwo':
                compareTwoSelected();
                break;
        }
    };

    $effect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;

            if (event.key === 'Shift') {
                // Held down, the browser repeats this indefinitely; the guard
                // inside revealHints keeps that to one timer.
                if (!isTextFieldTarget(target)) {
                    revealHints();
                }
                return;
            }

            const action = resolveShortcut(
                {
                    key: event.key,
                    shiftKey: event.shiftKey,
                    ctrlKey: event.ctrlKey,
                    metaKey: event.metaKey,
                    altKey: event.altKey,
                    inTextField: isTextFieldTarget(target),
                },
                liveShortcuts
            );
            if (!action) {
                return;
            }

            // Only once something matched: an unclaimed Shift+letter is still
            // the reader's to type wherever they are.
            event.preventDefault();
            runShortcut(action);
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                hideHints();
            }
        };

        /*
         * A QuickPick takes focus away from the webview, and the keyup that
         * would have hidden the badges is delivered to VS Code instead. Without
         * this the panel is left permanently wearing them.
         */
        const onBlur = () => hideHints();

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        window.addEventListener('blur', onBlur);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onBlur);
            clearTimeout(revealTimer);
        };
    });

    /**
     * `rowOrder` is derived from the commits that were just assigned, so the
     * new positions only exist once Svelte has flushed them.
     */
    const restoreScroll = async (
        anchor: NonNullable<ReturnType<typeof anchorAt>>
    ) => {
        await tick();
        const scrollTop = scrollTopFor(anchor, defaultMetrics.rowH, rowOrder);
        if (scrollTop !== null && graphScroller) {
            // Re-read rather than captured: committing everything takes the
            // working-tree row away, and the rows below it move up by one.
            graphScroller.scrollTop = scrollTop + graphScrollOffset;
        }
    };

    /**
     * An amend, a rebase, or a reset can take the selected commit out of the
     * graph. Keeping it selected leaves the details panel describing a commit
     * that is no longer reachable, and its files in a tree that can no longer
     * open them.
     */
    const dropVanishedCommitsFromSelection = () => {
        const present = new Set(rowOrder);
        const surviving = selection.hashes.filter((hash) => present.has(hash));
        if (surviving.length === selection.hashes.length) {
            return;
        }

        selection = { ...selection, hashes: surviving };
        if (selectedCommit && !present.has(selectedCommit.hash)) {
            selectedCommit = null;
        }
        postToHost({ type: 'compare:clear' });
        comparison = null;
    };

    /**
     * The same request the branch list sends, so a badge in the graph and a row
     * in the list open one menu rather than two that drift apart. A tag and a
     * detached HEAD are drawn as badges too and have no branch menu, so only
     * branch refs are given this.
     */
    const openBranchMenu = (ref: Ref) =>
        postToHost({
            type: 'branch:menu',
            name: ref.name,
            isRemote: ref.kind === 'remoteBranch',
            isCurrent: ref.isHead,
        });

    /**
     * The panel's height is the workbench's to change, so this is a request
     * rather than a state of our own — there is nothing here to remember, and
     * nothing to reflect back.
     */
    const toggleMaximized = () =>
        postToHost({ type: 'panel:toggleMaximized' });

    /** The branch list as a picker. The host owns it; this only asks. */
    const switchBranch = () => postToHost({ type: 'branch:switch' });

    const togglePane = (pane: Pane) => {
        panes = withPane(panes, pane, !panes[pane]);
        writeWebviewState(PANES_STATE_KEY, panes);
    };

    const handleToolbarAction = (action: ToolbarAction) => {
        if (action === 'refresh') {
            isLoading = true;
            postToHost({ type: 'graph:refresh' });
            return;
        }
        postToHost({ type: 'remote:operation', operation: action });
    };

    const handleSelectCommit = (commit: Commit, modifiers: SelectModifiers) => {
        // The two selections are mutually exclusive: "these commits, and also
        // whatever is uncommitted" is a different question, and the branch
        // menu's "Review my work against…" is the one that answers it.
        workingTreeSelected = false;
        selection = applySelection(
            selection,
            rowOrder,
            commit.hash,
            modifiers
        );
        selectedCommit = commit;
        requestChangesForSelection();
    };

    /**
     * Selects a commit the reader asked for from somewhere else, and shows it.
     *
     * Returns false when the graph does not have it — which is not necessarily
     * an error. The rows may simply not have arrived yet, and the caller holds
     * the request until they do.
     */
    const revealInGraph = (hash: string): boolean => {
        const commit = graph?.commits.find(
            (candidate) => candidate.hash === hash
        );
        if (!commit) {
            return false;
        }

        workingTreeSelected = false;
        selection = applySelection(selection, rowOrder, commit.hash, {
            toggle: false,
            range: false,
        });
        selectedCommit = commit;
        // Below the fold as often as not, so selecting it is not enough.
        void scrollCommitIntoView(commit.hash);
        return true;
    };

    /**
     * Centres a row rather than merely bringing it to an edge: a commit
     * revealed from somewhere else needs its neighbours visible to be worth
     * revealing at all.
     */
    const scrollCommitIntoView = async (hash: string) => {
        await tick();
        const index = rowOrder.indexOf(hash);
        if (index < 0 || !graphScroller) {
            return;
        }

        const target =
            index * defaultMetrics.rowH +
            graphScrollOffset -
            graphScroller.clientHeight / 2;
        graphScroller.scrollTop = Math.max(0, target);
    };

    const selectWorkingTree = () => {
        workingTreeSelected = true;
        selection = emptySelection;
        selectedCommit = null;
        // Not debounced, unlike a commit selection: this row cannot be part of
        // a range, so one click is the whole request.
        clearTimeout(pendingRequest);
        postToHost({ type: 'workingTree:select' });
    };

    /**
     * Selecting commits is the request: one commit shows its own changes, several
     * show their combined effect. Debounced because building a selection is
     * several clicks, and each intermediate state would otherwise start work — for
     * a multi-commit selection that means spawning a worktree per click.
     */
    let pendingRequest: ReturnType<typeof setTimeout> | undefined;
    const requestChangesForSelection = () => {
        clearTimeout(pendingRequest);
        const hashes = [...selection.hashes];

        pendingRequest = setTimeout(() => {
            if (hashes.length === 0) {
                postToHost({ type: 'compare:clear' });
                return;
            }
            if (hashes.length === 1) {
                postToHost({ type: 'commit:select', hash: hashes[0] });
                return;
            }
            postToHost({ type: 'compare:commits', hashes });
        }, 180);
    };

    const clearSelection = () => {
        selection = emptySelection;
        requestChangesForSelection();
    };

    /**
     * Diff exactly two commits against each other. Distinct from reviewing them
     * together: this asks how two states differ, not what the two commits changed.
     */
    /** Jumping to a parent from the details panel, when it is on screen. */
    const selectParentByHash = (hash: string) => {
        const parent = graph?.commits.find((commit) => commit.hash === hash);
        if (parent) {
            handleSelectCommit(parent, { toggle: false, range: false });
        }
    };

    const compareTwoSelected = () => {
        // Rows are newest-first, so the second selected is the older side.
        const [right, left] = [...selection.hashes];
        postToHost({ type: 'compare:twoCommits', left, right });
    };
</script>

<!-- min-w: below this the graph is unusable, so the page scrolls instead of squashing. -->
<div class="flex h-screen min-w-[320px] flex-col bg-app font-sans text-fg">
    {#if isLoading}
        <div class="flex h-full flex-col items-center justify-center">
            <div
                class="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-info-strong"
            ></div>
            <div class="text-lg font-medium text-fg-soft">
                Loading Git Repository
            </div>
            <div class="mt-2 text-sm text-fg-dim">
                Reading commit history…
            </div>
        </div>
    {:else if errorMessage}
        <div
            class="flex h-full flex-col items-center justify-center p-8 text-center"
        >
            <div class="mb-2 text-lg font-medium text-danger">
                Could not load the graph
            </div>
            <p class="max-w-md text-sm text-fg-dim">{errorMessage}</p>
            <div class="mt-4 flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-on-accent hover:bg-accent-hover"
                    onclick={() => handleToolbarAction('refresh')}
                >
                    Try again
                </button>
                <!-- Failing to load one repository is a common reason to want a
                     different one, and the toolbar is not rendered here. -->
                {#if repositories.length > 0}
                    <button
                        type="button"
                        data-testid="repository-picker-error"
                        class="rounded-md border border-line-strong bg-control px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-control-hover"
                        onclick={() =>
                            postToHost({ type: 'repository:menu' })}
                    >
                        Switch repository
                    </button>
                {/if}
            </div>
        </div>
    {:else}
        <div class="flex-shrink-0 border-b border-line">
            <Toolbar
                {currentBranchName}
                {repositories}
                {activeRepositoryRoot}
                onAction={handleToolbarAction}
                onSelectRepository={() =>
                    postToHost({ type: 'repository:menu' })}
                onToggleMaximized={toggleMaximized}
                onSwitchBranch={switchBranch}
                hintsShown={shortcutHintsShown}
                availableHints={liveShortcuts}
            />
        </div>

        {#if selecting}
            <!--
                A mode with no banner is a mode you can be in without knowing,
                which is the one thing wrong with modes. It says what the keys
                do rather than merely that it is on, because "SELECTING" on its
                own answers none of the questions it raises.
            -->
            <div
                data-testid="selection-mode-banner"
                class="flex flex-shrink-0 items-center gap-3 border-b border-info-strong/40 bg-selected px-4 py-2 text-xs"
            >
                <span class="font-medium text-info">Picking commits</span>
                <span class="text-fg-dim">
                    <kbd class="font-mono">Space</kbd> picks,
                    <kbd class="font-mono">Enter</kbd> shows the changes,
                    <kbd class="font-mono">Esc</kbd> leaves
                </span>
                <div class="flex-1"></div>
                <span class="tabular-nums text-fg-dim">
                    {selection.hashes.length} picked
                </span>
            </div>
        {/if}

        {#if selection.hashes.length > 1}
            <!-- Only shown once a multi-selection exists, so the normal case
                 keeps its full height. -->
            <div
                class="flex flex-shrink-0 items-center gap-3 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs"
            >
                <span class="font-medium text-warn-soft">
                    {selection.hashes.length} commits selected
                </span>
                <span class="text-warn-soft/70">
                    {selectionIsContiguous
                        ? 'contiguous range'
                        : 'not contiguous — will be reconstructed'}
                </span>
                <div class="flex-1"></div>
                {#if selection.hashes.length === 2}
                    <!-- The combined effect is shown automatically; this asks the
                         other question, how the two states differ. -->
                    <div class="relative flex">
                        <button
                            type="button"
                            class="rounded border border-warn/50 px-2 py-1 font-medium text-warn-soft hover:bg-warn/20"
                            onclick={compareTwoSelected}
                            title="How do these two commits differ?"
                        >
                            Diff the two instead
                        </button>
                        <ShortcutHint
                            action="diffTwo"
                            shown={shortcutHintsShown &&
                                liveShortcuts.has('diffTwo')}
                        />
                    </div>
                {/if}
                <div class="relative flex">
                    <button
                        type="button"
                        class="text-warn-soft/80 underline hover:text-warn-soft"
                        onclick={clearSelection}
                    >
                        Clear
                    </button>
                    <ShortcutHint
                        action="clearSelection"
                        shown={shortcutHintsShown &&
                            liveShortcuts.has('clearSelection')}
                    />
                </div>
            </div>
        {/if}

        <div class="flex flex-1 overflow-hidden">
            {#if panes.branches}
                <div class="w-64 flex-shrink-0 bg-pane">
                    <BranchList
                        bind:this={branchList}
                        {branches}
                        {worktrees}
                        onOpenMenu={(branch) =>
                            postToHost({
                                type: 'branch:menu',
                                name: branch.name,
                                isRemote: branch.isRemote,
                                isCurrent: branch.isCurrent,
                            })}
                        onOpenWorktreeMenu={(path) =>
                            postToHost({ type: 'worktree:menu', path })}
                        {stashes}
                        onOpenStashMenu={(ref) =>
                            postToHost({ type: 'stash:menu', ref })}
                        onOpenRemoteMenu={() =>
                            postToHost({ type: 'remotes:menu' })}
                        hintsShown={shortcutHintsShown}
                        availableHints={liveShortcuts}
                    />
                </div>
            {/if}
            <!-- Always rendered, collapsed or not: the way back is in the same
                 place as the way out, so folding a pane away cannot hide its
                 own control. -->
            <PaneHandle
                pane="branches"
                side="left"
                visible={panes.branches}
                onToggle={togglePane}
                hintShown={shortcutHintsShown &&
                    liveShortcuts.has('toggleBranches')}
            />

            <div class="relative flex flex-1 flex-col overflow-hidden">
                <!--
                    The graph's three keys have no control to hang a badge off:
                    they act on the whole list rather than on any one thing in
                    it. So they get a strip of their own, in the list they act
                    on, on the same Shift that reveals every other badge.

                    With a word each, unlike the badges elsewhere. A bare letter
                    is enough on a button that already says "Refresh"; floating
                    over a graph it would say nothing at all.

                    Bottom left, because the newest commits are at the top and
                    that is where the eye already is.
                -->
                {#if shortcutHintsShown && graph}
                    <div
                        data-testid="graph-key-legend"
                        aria-hidden="true"
                        class="pointer-events-none absolute bottom-2 left-2 z-20 flex items-center gap-3 rounded-md border border-line-strong bg-pane/95 px-2.5 py-1.5 text-[10px] text-fg-dim shadow-lg"
                    >
                        {#each graphKeyLegend as entry (entry.action)}
                            <span class="flex items-center gap-1.5">
                                <span
                                    class="rounded-[3px] bg-fg px-1 py-px font-mono font-bold text-app"
                                >
                                    {shortcutKey(entry.action)}
                                </span>
                                {entry.label}
                            </span>
                        {/each}
                        <span class="flex items-center gap-1.5 border-l border-line pl-3">
                            <span class="font-mono text-fg-faint">↑↓</span>
                            move the cursor
                        </span>
                    </div>
                {/if}
                <div
                    bind:this={graphScroller}
                    class="flex-1 overflow-auto bg-graph"
                    data-testid="graph-scroller"
                >
                    {#if graph && !workingTreeIsClean}
                        <!-- Above the graph and inside its scroller, because it
                             belongs at the newest end of the history and should
                             scroll away with it. -->
                        <WorkingTreeRow
                            status={workingTree}
                            gutterWidth={graphGutterWidth}
                            selected={workingTreeSelected}
                            onSelect={selectWorkingTree}
                            cursor={cursorOnWorkingTree}
                            tabbable={cursorOnWorkingTree}
                            {selecting}
                            onGraphKey={handleGraphKey}
                        />
                    {/if}
                    {#if graph}
                        <GitGraph
                            {graph}
                            selectedHash={selectedCommit?.hash ?? null}
                            comparedHashes={selectedHashes}
                            onSelect={handleSelectCommit}
                            onContextMenu={(commit) =>
                                postToHost({
                                    type: 'commit:menu',
                                    hash: commit.hash,
                                })}
                            {cursorHash}
                            {selecting}
                            cursorAbove={cursorOnWorkingTree}
                            onGraphKey={(action, commit) =>
                                handleGraphKey(action, commit.hash)}
                        >
                            {#snippet row(commit: Commit)}
                                <!-- Fixed-width metadata columns with the
                                     message absorbing the slack, so the author
                                     never wraps and the date never shifts. -->
                                <div class="flex items-center gap-3">
                                    <span
                                        class="w-16 flex-shrink-0 font-mono text-xs whitespace-nowrap text-info"
                                    >
                                        {commit.shortHash}
                                    </span>
                                    {#if commit.refs.length > 0}
                                        <span
                                            class="flex flex-shrink-0 items-center gap-1"
                                        >
                                            {#each commit.sortedRefs.slice(0, 3) as ref (ref.kind + ref.name)}
                                                <RefBadge
                                                    {ref}
                                                    onActivate={
                                                        isBranchRef(ref)
                                                            ? openBranchMenu
                                                            : undefined
                                                    }
                                                />
                                            {/each}
                                            {#if commit.refs.length > 3}
                                                <span
                                                    class="text-[10px] text-fg-faint"
                                                    title={commit.sortedRefs
                                                        .slice(3)
                                                        .map((r) => r.name)
                                                        .join(', ')}
                                                >
                                                    +{commit.refs.length - 3}
                                                </span>
                                            {/if}
                                        </span>
                                    {/if}
                                    <span
                                        class="min-w-0 flex-1 truncate text-sm font-medium text-fg"
                                        title={commit.message}
                                    >
                                        {commit.subject}
                                    </span>
                                    <span
                                        class="w-32 flex-shrink-0 truncate text-right text-xs whitespace-nowrap text-fg-dim"
                                        title={commit.author}
                                    >
                                        {commit.author}
                                    </span>
                                    <span
                                        class="w-32 flex-shrink-0 pr-3 text-right text-xs whitespace-nowrap tabular-nums text-fg-faint"
                                        title={commitTimestampTooltip(
                                            commit.timestamp
                                        )}
                                    >
                                        {commitTimestamp(commit.timestamp)}
                                    </span>
                                </div>
                            {/snippet}
                        </GitGraph>
                        {#if hasMoreHistory}
                            <div
                                class="border-t border-line px-3 py-2 text-center text-xs text-fg-faint"
                            >
                                Older history not shown — raise
                                <code class="text-fg-dim">
                                    gitHawk.commitLimit
                                </code>
                                to load more.
                            </div>
                        {/if}
                    {:else}
                        <div
                            class="flex h-full items-center justify-center text-sm text-fg-dim"
                        >
                            This repository has no commits yet.
                        </div>
                    {/if}
                </div>
            </div>

            <PaneHandle
                pane="details"
                side="right"
                visible={panes.details}
                onToggle={togglePane}
                hintShown={shortcutHintsShown &&
                    liveShortcuts.has('toggleDetails')}
            />
            {#if panes.details}
                <div class="w-80 flex-shrink-0 bg-pane">
                    {#if showAggregate && comparison}
                        <ComparisonSummary
                            {comparison}
                            commits={selectedCommits}
                        />
                    {:else}
                        <CommitDetails
                            {selectedCommit}
                            totals={selectedCommitTotals}
                            onCopyHash={(hash) =>
                                postToHost({ type: 'commit:copyHash', hash })}
                            onSelectParent={selectParentByHash}
                        />
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>
