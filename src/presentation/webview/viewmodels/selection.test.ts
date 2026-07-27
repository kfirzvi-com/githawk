import { describe, expect, test } from 'vitest';
import {
    applySelection,
    emptySelection,
    isContiguous,
    type SelectionState,
} from './selection';

const rows = ['r0', 'r1', 'r2', 'r3', 'r4'];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };

const select = (
    state: SelectionState,
    hash: string,
    modifiers = plain
): SelectionState => applySelection(state, rows, hash, modifiers);

describe('applySelection', () => {
    test('a plain click replaces the selection', () => {
        const first = select(emptySelection, 'r1');
        expect(first.hashes).toEqual(['r1']);

        const second = select(first, 'r3');
        expect(second.hashes).toEqual(['r3']);
        expect(second.anchorHash).toBe('r3');
    });

    test('cmd-click adds and removes individual commits', () => {
        let state = select(emptySelection, 'r1');
        state = select(state, 'r3', toggle);
        expect(state.hashes).toEqual(['r1', 'r3']);

        state = select(state, 'r1', toggle);
        expect(state.hashes).toEqual(['r3']);
    });

    test('keeps the selection in row order however it was clicked', () => {
        let state = select(emptySelection, 'r4');
        state = select(state, 'r0', toggle);
        state = select(state, 'r2', toggle);

        // Clicked 4, 0, 2 — stored top-to-bottom, which is what a review reads in.
        expect(state.hashes).toEqual(['r0', 'r2', 'r4']);
    });

    test('shift-click extends from the anchor, in either direction', () => {
        const anchored = select(emptySelection, 'r3');

        expect(select(anchored, 'r1', range).hashes).toEqual(['r1', 'r2', 'r3']);
        expect(select(anchored, 'r4', range).hashes).toEqual(['r3', 'r4']);
    });

    test('the anchor stays put so a second shift-click re-measures', () => {
        let state = select(emptySelection, 'r1');
        state = select(state, 'r3', range);
        expect(state.hashes).toEqual(['r1', 'r2', 'r3']);

        // Extending again grows from r1, rather than from the last click.
        state = select(state, 'r4', range);
        expect(state.hashes).toEqual(['r1', 'r2', 'r3', 'r4']);
    });

    test('shift-click without an anchor selects just the clicked commit', () => {
        expect(select(emptySelection, 'r2', range).hashes).toEqual(['r2']);
    });

    test('removing the anchor hands the role to what remains', () => {
        let state = select(emptySelection, 'r1');
        state = select(state, 'r3', toggle);
        state = select(state, 'r3', toggle);

        expect(state.hashes).toEqual(['r1']);
        expect(state.anchorHash).toBe('r1');
    });

    test('a stale anchor from a refreshed graph does not throw', () => {
        const stale: SelectionState = { anchorHash: 'gone', hashes: ['gone'] };
        expect(applySelection(stale, rows, 'r2', range).hashes).toEqual(['r2']);
    });

    test('toggling everything off leaves an empty selection', () => {
        let state = select(emptySelection, 'r0');
        state = select(state, 'r0', toggle);

        expect(state.hashes).toEqual([]);
        expect(state.anchorHash).toBeNull();
    });
});

describe('isContiguous', () => {
    test('recognises an unbroken run', () => {
        expect(isContiguous(rows, ['r1', 'r2', 'r3'])).toBe(true);
    });

    test('recognises a gap', () => {
        expect(isContiguous(rows, ['r1', 'r3'])).toBe(false);
    });

    test('treats zero or one commit as contiguous', () => {
        expect(isContiguous(rows, [])).toBe(true);
        expect(isContiguous(rows, ['r2'])).toBe(true);
    });

    test('is insensitive to the order given', () => {
        expect(isContiguous(rows, ['r3', 'r1', 'r2'])).toBe(true);
    });

    test('reports a selection containing an unknown hash as not contiguous', () => {
        expect(isContiguous(rows, ['r1', 'missing'])).toBe(false);
    });
});
