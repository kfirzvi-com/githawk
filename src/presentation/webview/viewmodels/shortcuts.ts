/**
 * Hold Shift and every control that has a shortcut says which key it is; keep
 * holding it and press that key to run the control. Basecamp's idea, and the
 * reason it works is that nothing has to be memorised in advance — the list of
 * shortcuts is the screen itself, so it is always accurate and always in the
 * place the action is.
 *
 * This module is the whole of the rule set: which keys exist, which of them are
 * live given what is on screen, and what a keystroke resolves to. It is
 * deliberately free of DOM types so it can be tested as arithmetic rather than
 * through a rendered page — the components below it only draw badges and call
 * the handler they already had.
 */

export type ShortcutAction =
    | 'refresh'
    | 'fetch'
    | 'pull'
    | 'push'
    | 'switchRepository'
    | 'switchBranch'
    | 'filterBranches'
    | 'manageRemotes'
    | 'manageWorktrees'
    | 'manageStashes'
    | 'toggleBranches'
    | 'toggleDetails'
    | 'toggleMaximized'
    | 'focusGraph'
    | 'selectionMode'
    | 'showSelectionChanges'
    | 'clearSelection'
    | 'diffTwo';

/**
 * Cmd+9 (Ctrl+9 elsewhere), the key that opens the panel from anywhere in
 * VS Code. Pressed with the graph already focused it means the opposite, and
 * only the graph can tell: the workbench's `focusedView` context is not set
 * while focus is inside a webview's iframe, so a keybinding on it never fires.
 * The page claims the key itself and asks the host to close the panel.
 */
export function isPanelKey(event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}): boolean {
    return (
        event.key === '9' &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey
    );
}

export interface ShortcutSpec {
    id: ShortcutAction;
    /** Always lowercase: Shift is the modifier, not part of the letter. */
    key: string;
    /** How the action reads in a list, sentence case, no trailing stop. */
    label: string;
}

/**
 * Every key is a letter, and every letter is a mnemonic for its own action
 * rather than a position in a row. Two are worth naming: pull and push start
 * with the same letter, so pull is "update"; and checking out a branch is `t`,
 * because b, c, s and w had all gone by the time it arrived — "check ouT" is
 * the story, and it is a thin one.
 *
 * Keys are unique across the whole application, not per pane. Two panes that
 * each claimed `s` would work right up until both were on screen, which is the
 * normal case, and the loser would be whichever handler ran second.
 */
export const shortcuts: readonly ShortcutSpec[] = [
    { id: 'refresh', key: 'r', label: 'Refresh the graph' },
    { id: 'fetch', key: 'f', label: 'Fetch' },
    { id: 'pull', key: 'u', label: 'Pull (update)' },
    { id: 'push', key: 'p', label: 'Push' },
    { id: 'switchRepository', key: 'o', label: 'Switch repository' },
    { id: 'switchBranch', key: 't', label: 'Check out a branch' },
    { id: 'filterBranches', key: 'k', label: 'Filter branches' },
    { id: 'manageRemotes', key: 'm', label: 'Manage remotes' },
    { id: 'manageWorktrees', key: 'w', label: 'Manage worktrees' },
    { id: 'manageStashes', key: 's', label: 'Manage stashes' },
    { id: 'toggleBranches', key: 'b', label: 'Show or hide the branch list' },
    { id: 'toggleDetails', key: 'd', label: 'Show or hide commit details' },
    { id: 'toggleMaximized', key: 'e', label: 'Expand the panel, or put it back' },
    { id: 'focusGraph', key: 'g', label: 'Put the cursor in the graph' },
    { id: 'selectionMode', key: 'v', label: 'Pick commits with Space' },
    { id: 'showSelectionChanges', key: 'a', label: 'Show what the selection changed' },
    { id: 'clearSelection', key: 'c', label: 'Clear the selection' },
    { id: 'diffTwo', key: 'x', label: 'Diff the two selected commits' },
];

const byId = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]));

/** What the badge on a control shows. Upper case: it is read, not typed. */
export function shortcutKey(id: ShortcutAction): string {
    return (byId.get(id)?.key ?? '').toUpperCase();
}

/**
 * What has to be true for each shortcut to mean anything right now.
 *
 * A badge is a promise that the key does something, so the same predicate has
 * to decide both whether the badge is drawn and whether the keystroke runs.
 * Two lists would drift, and the failure is silent in both directions: a badge
 * on a dead key, or a working key nobody can discover.
 */
export interface ShortcutContext {
    /**
     * False while the graph is loading and while it is showing an error: both
     * replace the whole panel, toolbar included, so none of these controls are
     * there to be pressed.
     */
    panelReady: boolean;
    /** The repository picker only exists once the host has reported some. */
    hasRepositories: boolean;
    /** Folded away, the branch list's own controls are not on screen. */
    branchesPaneVisible: boolean;
    /** The selection bar appears above one, and grows a Diff button at two. */
    selectionCount: number;
    /** Nothing to put a cursor on, or to pick from, in an empty repository. */
    commitCount: number;
}

export function availableShortcuts(
    context: ShortcutContext
): Set<ShortcutAction> {
    if (!context.panelReady) {
        return new Set<ShortcutAction>();
    }

    const available = new Set<ShortcutAction>([
        'refresh',
        'fetch',
        'pull',
        'push',
        'switchBranch',
        'toggleBranches',
        'toggleDetails',
        'toggleMaximized',
    ]);

    if (context.commitCount > 0) {
        available.add('focusGraph');
        available.add('selectionMode');
    }
    if (context.hasRepositories) {
        available.add('switchRepository');
    }
    if (context.branchesPaneVisible) {
        available.add('filterBranches');
        available.add('manageRemotes');
        available.add('manageWorktrees');
        available.add('manageStashes');
    }
    if (context.selectionCount > 0) {
        // One commit's changes are worth asking for again too: the Changes tree
        // is only revealed the first time, so this is the way back to it.
        available.add('showSelectionChanges');
    }
    if (context.selectionCount > 1) {
        available.add('clearSelection');
    }
    if (context.selectionCount === 2) {
        available.add('diffTwo');
    }

    return available;
}

/** The parts of a keyboard event this cares about, and nothing else. */
export interface ShortcutKeyEvent {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    /** True when the keystroke is on its way into a text field. */
    inTextField: boolean;
}

/**
 * Which action a keystroke runs, or null for the overwhelming majority that
 * run none.
 *
 * Shift and nothing else: Ctrl, Cmd and Alt combinations belong to VS Code and
 * to the operating system, and swallowing one here would shadow a binding the
 * reader chose. A text field takes precedence over everything — Shift+K in the
 * branch filter is a capital K, and a filter that cannot type capitals is
 * worse than no shortcut at all.
 */
export function resolveShortcut(
    event: ShortcutKeyEvent,
    available: ReadonlySet<ShortcutAction>
): ShortcutAction | null {
    if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        return null;
    }
    if (event.inTextField) {
        return null;
    }

    // Shift makes `key` the capital, so the comparison has to be case-blind.
    // Anything longer than one character is a named key — Tab, ArrowDown — and
    // none of those are shortcuts.
    const pressed = event.key.toLowerCase();
    if (pressed.length !== 1) {
        return null;
    }

    const match = shortcuts.find((shortcut) => shortcut.key === pressed);
    return match && available.has(match.id) ? match.id : null;
}

/**
 * Whether a keystroke is going into something the reader is typing in.
 *
 * Takes the shape of an element rather than an element, so the rule stays
 * testable without a DOM. A null target — the event reached the window with
 * nothing focused — is not a text field.
 */
export function isTextFieldTarget(
    target: { tagName?: string; isContentEditable?: boolean } | null
): boolean {
    if (!target) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }

    const tag = (target.tagName ?? '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
