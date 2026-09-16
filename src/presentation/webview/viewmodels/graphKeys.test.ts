import { describe, expect, it } from 'vitest';
import {
    WORKING_TREE_ROW,
    initialCursor,
    isMove,
    keyboardRows,
    moveCursor,
    resolveGraphKey,
    type GraphKeyEvent,
} from './graphKeys';

const rows = ['a', 'b', 'c', 'd', 'e'];

const press = (
    key: string,
    overrides: Partial<GraphKeyEvent> = {}
): GraphKeyEvent => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
});

describe('resolveGraphKey', () => {
    it('moves on the arrows and the jump keys', () => {
        expect(resolveGraphKey(press('ArrowUp'), false)).toBe('moveUp');
        expect(resolveGraphKey(press('ArrowDown'), false)).toBe('moveDown');
        expect(resolveGraphKey(press('Home'), false)).toBe('moveFirst');
        expect(resolveGraphKey(press('End'), false)).toBe('moveLast');
        expect(resolveGraphKey(press('PageUp'), false)).toBe('movePageUp');
        expect(resolveGraphKey(press('PageDown'), false)).toBe('movePageDown');
    });

    /**
     * Holding Shift reveals the shortcut badges. A reader holding it while
     * arrowing down the graph means to move down the graph.
     */
    it('still moves while Shift is held', () => {
        expect(resolveGraphKey(press('ArrowDown', { shiftKey: true }), false)).toBe(
            'moveDown'
        );
    });

    it('leaves Ctrl, Cmd and Alt combinations to VS Code', () => {
        expect(resolveGraphKey(press('ArrowDown', { ctrlKey: true }), false)).toBe(
            null
        );
        expect(resolveGraphKey(press('ArrowDown', { metaKey: true }), false)).toBe(
            null
        );
        expect(resolveGraphKey(press('Enter', { altKey: true }), false)).toBe(null);
    });

    it('is the left click on Enter and the right click on Shift+Enter', () => {
        expect(resolveGraphKey(press('Enter'), false)).toBe('activate');
        expect(resolveGraphKey(press('Enter', { shiftKey: true }), false)).toBe(
            'contextMenu'
        );
    });

    /** What a reader with one of those keys will already try. */
    it('takes the context-menu key and Shift+F10 as the right click too', () => {
        expect(resolveGraphKey(press('ContextMenu'), false)).toBe('contextMenu');
        expect(resolveGraphKey(press('F10', { shiftKey: true }), false)).toBe(
            'contextMenu'
        );
        // Plain F10 is VS Code's, not ours.
        expect(resolveGraphKey(press('F10'), false)).toBe(null);
    });

    describe('selection mode', () => {
        it('picks with Space, and only in the mode', () => {
            expect(resolveGraphKey(press(' '), true)).toBe('toggleInSelection');
            // Outside it the row is an ordinary button and Space is its click,
            // which the browser already does.
            expect(resolveGraphKey(press(' '), false)).toBe(null);
        });

        it('takes the older Spacebar name too', () => {
            expect(resolveGraphKey(press('Spacebar'), true)).toBe(
                'toggleInSelection'
            );
        });

        /** Enter must not throw away picks it took several presses to build. */
        it('confirms on Enter rather than replacing the selection', () => {
            expect(resolveGraphKey(press('Enter'), true)).toBe('confirmSelection');
        });

        it('leaves on Escape, and hands a stray Escape back to App', () => {
            expect(resolveGraphKey(press('Escape'), true)).toBe(
                'leaveSelectionMode'
            );
            expect(resolveGraphKey(press('Escape'), false)).toBe(null);
        });
    });

    it('lets every other key through', () => {
        expect(resolveGraphKey(press('a'), false)).toBe(null);
        expect(resolveGraphKey(press('Tab'), false)).toBe(null);
        expect(resolveGraphKey(press('R', { shiftKey: true }), false)).toBe(null);
    });
});

describe('isMove', () => {
    it('separates the actions that only move from the ones that do something', () => {
        expect(isMove('moveUp')).toBe(true);
        expect(isMove('movePageDown')).toBe(true);
        expect(isMove('activate')).toBe(false);
        expect(isMove('toggleInSelection')).toBe(false);
    });
});

describe('moveCursor', () => {
    it('steps one row at a time', () => {
        expect(moveCursor(rows, 'b', 'moveDown', 10)).toBe('c');
        expect(moveCursor(rows, 'b', 'moveUp', 10)).toBe('a');
    });

    /**
     * Clamped, not wrapped: arriving at the oldest commit by pressing Down one
     * time too many is a worse surprise than stopping.
     */
    it('stops at both ends', () => {
        expect(moveCursor(rows, 'a', 'moveUp', 10)).toBe('a');
        expect(moveCursor(rows, 'e', 'moveDown', 10)).toBe('e');
    });

    it('jumps to either end', () => {
        expect(moveCursor(rows, 'c', 'moveFirst', 10)).toBe('a');
        expect(moveCursor(rows, 'c', 'moveLast', 10)).toBe('e');
    });

    it('pages by the height of the panel, clamped to the ends', () => {
        expect(moveCursor(rows, 'a', 'movePageDown', 3)).toBe('d');
        expect(moveCursor(rows, 'e', 'movePageUp', 3)).toBe('b');
        expect(moveCursor(rows, 'd', 'movePageDown', 3)).toBe('e');
    });

    /** A page that rounds to nothing is a broken key. */
    it('always moves at least one row, however short the panel', () => {
        expect(moveCursor(rows, 'b', 'movePageDown', 0)).toBe('c');
        expect(moveCursor(rows, 'b', 'movePageUp', 0.4)).toBe('a');
    });

    /**
     * The graph reloaded and the cursor's commit went with it — an amend, a
     * rebase, a reset.
     */
    it('starts again from the end the reader was heading towards', () => {
        expect(moveCursor(rows, 'gone', 'moveDown', 10)).toBe('a');
        expect(moveCursor(rows, null, 'moveDown', 10)).toBe('a');
        expect(moveCursor(rows, 'gone', 'moveUp', 10)).toBe('e');
        expect(moveCursor(rows, null, 'movePageUp', 10)).toBe('e');
    });

    it('has nowhere to go in an empty graph', () => {
        expect(moveCursor([], 'a', 'moveDown', 10)).toBe(null);
    });
});

describe('initialCursor', () => {
    it('picks up where the mouse left off', () => {
        expect(initialCursor(rows, 'c')).toBe('c');
    });

    it('starts at the newest commit when nothing is selected', () => {
        expect(initialCursor(rows, null)).toBe('a');
        // Selected, but no longer in the graph.
        expect(initialCursor(rows, 'gone')).toBe('a');
    });

    it('has nothing to point at in an empty graph', () => {
        expect(initialCursor([], null)).toBe(null);
    });
});

describe('keyboardRows', () => {
    it('puts the uncommitted row above the newest commit when the tree is dirty', () => {
        expect(keyboardRows(rows, true)).toEqual([WORKING_TREE_ROW, ...rows]);
    });

    it('is the commits alone when the tree is clean', () => {
        expect(keyboardRows(rows, false)).toEqual(rows);
    });

    /**
     * The bug this exists for: Up on the newest commit stopped dead, with the
     * uncommitted row visibly above it.
     */
    it('lets Up reach the uncommitted row from the newest commit, and Home from anywhere', () => {
        const withWorkingTree = keyboardRows(rows, true);

        expect(moveCursor(withWorkingTree, 'a', 'moveUp', 10)).toBe(
            WORKING_TREE_ROW
        );
        expect(moveCursor(withWorkingTree, 'd', 'moveFirst', 10)).toBe(
            WORKING_TREE_ROW
        );
        // And Down from it lands on the newest commit.
        expect(moveCursor(withWorkingTree, WORKING_TREE_ROW, 'moveDown', 10)).toBe(
            'a'
        );
    });

    it('cannot be mistaken for a hash', () => {
        expect(/^[0-9a-f]+$/i.test(WORKING_TREE_ROW)).toBe(false);
    });
});
