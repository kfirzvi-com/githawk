/** Which selection gesture was used. */
export interface SelectModifiers {
    /** Cmd/Ctrl: add or remove one commit. */
    toggle: boolean;
    /** Shift: extend from the anchor to the clicked commit. */
    range: boolean;
}

export interface SelectionState {
    /** Where a shift-extension measures from. */
    anchorHash: string | null;
    /** Selected hashes, in row order (newest first). */
    hashes: string[];
}

export const emptySelection: SelectionState = { anchorHash: null, hashes: [] };

/**
 * Selection behaviour, kept out of the component so it can be tested directly.
 * The gestures follow the platform conventions people already have: plain click
 * replaces, Cmd/Ctrl toggles one, Shift extends a run.
 */
export function applySelection(
    state: SelectionState,
    rowOrder: string[],
    clickedHash: string,
    modifiers: SelectModifiers
): SelectionState {
    if (modifiers.range && state.anchorHash) {
        const from = rowOrder.indexOf(state.anchorHash);
        const to = rowOrder.indexOf(clickedHash);

        if (from === -1 || to === -1) {
            return { anchorHash: clickedHash, hashes: [clickedHash] };
        }

        const [start, end] = from <= to ? [from, to] : [to, from];
        return {
            // The anchor stays put, so extending again grows from the same place.
            anchorHash: state.anchorHash,
            hashes: rowOrder.slice(start, end + 1),
        };
    }

    if (modifiers.toggle) {
        const already = state.hashes.includes(clickedHash);
        const hashes = already
            ? state.hashes.filter((hash) => hash !== clickedHash)
            : orderedBy(rowOrder, [...state.hashes, clickedHash]);

        return {
            // Removing the anchor hands the role to whatever is left.
            anchorHash: already
                ? (hashes[0] ?? null)
                : clickedHash,
            hashes,
        };
    }

    return { anchorHash: clickedHash, hashes: [clickedHash] };
}

/** Keeps a selection in row order regardless of the order things were clicked. */
function orderedBy(rowOrder: string[], hashes: string[]): string[] {
    const wanted = new Set(hashes);
    return rowOrder.filter((hash) => wanted.has(hash));
}

/**
 * True when the selection is one unbroken run of rows. Worth knowing because a
 * contiguous run can be compared as a real git range, while a scattered
 * selection has to be reconstructed.
 */
export function isContiguous(
    rowOrder: string[],
    hashes: string[]
): boolean {
    if (hashes.length <= 1) {
        return true;
    }

    const indices = hashes
        .map((hash) => rowOrder.indexOf(hash))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);

    return indices.length === hashes.length &&
        indices[indices.length - 1] - indices[0] === indices.length - 1;
}
