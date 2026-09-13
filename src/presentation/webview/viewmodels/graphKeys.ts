/**
 * What the keyboard does once the graph itself has focus.
 *
 * This is the other half of `shortcuts.ts`, and deliberately a different shape.
 * Those are Shift+letter, global, and advertise themselves with a badge on the
 * control they run. These are the graph's own keys — arrows, Enter, Space —
 * which belong to whatever is focused, the way they do in a list anywhere else.
 * A badge on every row would be noise, and a reader who has just moved the
 * cursor with an arrow key does not need to be told that arrow keys work.
 *
 * Two things keep them apart: these only fire while a commit row holds DOM
 * focus, and none of them is a bare letter, so nothing here can shadow a
 * Shift+letter shortcut or a keystroke meant for VS Code.
 */

/** Where the cursor goes, or what it does where it is. */
export type GraphKeyAction =
    | 'moveUp'
    | 'moveDown'
    | 'moveFirst'
    | 'moveLast'
    | 'movePageUp'
    | 'movePageDown'
    /** The left click: select this commit alone. */
    | 'activate'
    /** The right click: this commit's own menu. */
    | 'contextMenu'
    /** Selection mode only: add or remove this commit from the picks. */
    | 'toggleInSelection'
    /** Selection mode only: show what the picked commits changed, and leave. */
    | 'confirmSelection'
    /** Selection mode only: leave, keeping the picks but asking for nothing. */
    | 'leaveSelectionMode';

const MOVES: Record<string, GraphKeyAction> = {
    ArrowUp: 'moveUp',
    ArrowDown: 'moveDown',
    Home: 'moveFirst',
    End: 'moveLast',
    PageUp: 'movePageUp',
    PageDown: 'movePageDown',
};

/** The parts of a keyboard event this cares about, and nothing else. */
export interface GraphKeyEvent {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
}

/**
 * Which action a keystroke runs on the focused graph, or null to let it through.
 *
 * Ctrl, Cmd and Alt combinations are let through untouched, for the reason the
 * Shift+letter layer leaves them alone: they belong to VS Code and to the
 * operating system, and a graph that swallowed one would shadow a binding the
 * reader chose.
 */
export function resolveGraphKey(
    event: GraphKeyEvent,
    selecting: boolean
): GraphKeyAction | null {
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return null;
    }

    /*
     * Shift is ignored on a move. Holding it reveals the shortcut badges, and a
     * reader who is holding it while arrowing down the graph means to move down
     * the graph — the alternative is a cursor that stops dead for no stated
     * reason.
     */
    const move = MOVES[event.key];
    if (move) {
        return move;
    }

    /*
     * Enter is the left click and Shift+Enter the right one: the same key, the
     * other button. The dedicated context-menu key and Shift+F10 do it too,
     * because that is what a reader who has one of those will already try —
     * neither exists on a Mac keyboard, which is why they are the alias rather
     * than the binding.
     */
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        return 'contextMenu';
    }
    if (event.key === 'Enter') {
        if (event.shiftKey) {
            return 'contextMenu';
        }
        return selecting ? 'confirmSelection' : 'activate';
    }

    if (event.key === 'Escape') {
        // Outside the mode there is nothing here to leave; App decides whether
        // a stray Escape should clear the selection instead.
        return selecting ? 'leaveSelectionMode' : null;
    }

    /*
     * Space is the pick, but only in selection mode. Outside it the row is an
     * ordinary button and Space is its click, which is both what the browser
     * would do anyway and the right answer — a key that does nothing on a
     * focused control is worse than one that does the obvious thing.
     */
    if (event.key === ' ' || event.key === 'Spacebar') {
        return selecting ? 'toggleInSelection' : null;
    }

    return null;
}

/** True for the actions that only move the cursor, changing nothing else. */
export function isMove(action: GraphKeyAction): boolean {
    return Object.values(MOVES).includes(action);
}

/**
 * Where the cursor lands, as a hash, or null when there is nowhere to go.
 *
 * Clamped rather than wrapped. A list of commits has a newest and an oldest
 * end, and arriving at the oldest commit by pressing Down one time too many is
 * a worse surprise than stopping.
 *
 * A cursor that is not in `rowOrder` at all — the graph reloaded and its commit
 * went with it — starts again from the top for Down and from the bottom for Up,
 * which is where a reader with no position would expect to begin.
 */
export function moveCursor(
    rowOrder: readonly string[],
    cursorHash: string | null,
    action: GraphKeyAction,
    pageSize: number
): string | null {
    if (rowOrder.length === 0) {
        return null;
    }

    const last = rowOrder.length - 1;
    // At least one row, however short the panel is: a Page Down that does not
    // move is a broken key.
    const page = Math.max(1, Math.floor(pageSize));
    const current = cursorHash === null ? -1 : rowOrder.indexOf(cursorHash);

    if (current < 0) {
        switch (action) {
            case 'moveUp':
            case 'moveLast':
            case 'movePageUp':
                return rowOrder[last];
            default:
                return rowOrder[0];
        }
    }

    const clamp = (index: number) => rowOrder[Math.min(last, Math.max(0, index))];

    switch (action) {
        case 'moveUp':
            return clamp(current - 1);
        case 'moveDown':
            return clamp(current + 1);
        case 'moveFirst':
            return rowOrder[0];
        case 'moveLast':
            return rowOrder[last];
        case 'movePageUp':
            return clamp(current - page);
        case 'movePageDown':
            return clamp(current + page);
        default:
            return cursorHash;
    }
}

/**
 * Where the cursor should sit when the graph is first focused.
 *
 * The selected commit, so that focusing the graph picks up where the mouse left
 * off; otherwise the newest row, which is where the eye already is.
 */
export function initialCursor(
    rowOrder: readonly string[],
    selectedHash: string | null
): string | null {
    if (selectedHash && rowOrder.includes(selectedHash)) {
        return selectedHash;
    }
    return rowOrder[0] ?? null;
}
