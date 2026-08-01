/**
 * Keeping the reader's place across a reload.
 *
 * The graph is newest-first, so a new commit is inserted at the *top*. Leaving
 * `scrollTop` alone therefore does not leave the view alone: every row the
 * reader is looking at slides down by one. Once the graph reloads by itself
 * that happens without them asking, which is the difference between a panel
 * that keeps up and one that will not sit still.
 *
 * Rows are a fixed height, so an anchor is a row plus how far into it the
 * viewport starts — no measuring the DOM, and testable without one.
 */
export interface ScrollAnchor {
    /** The commit at the top of the viewport. */
    hash: string;
    /** Pixels of that row scrolled past, so the view does not jump by up to a row. */
    offset: number;
}

/**
 * What the viewport is currently anchored to, or null when there is nothing
 * worth restoring — the top of the list is already where a reload lands.
 */
export function anchorAt(
    scrollTop: number,
    rowHeight: number,
    rowOrder: readonly string[]
): ScrollAnchor | null {
    if (scrollTop <= 0 || rowHeight <= 0) {
        return null;
    }

    const index = Math.floor(scrollTop / rowHeight);
    const hash = rowOrder[index];

    return hash === undefined
        ? null
        : { hash, offset: scrollTop - index * rowHeight };
}

/**
 * Where to scroll so the anchored row sits where it did, or null when the row
 * has gone — an amend, a rebase, or a commit that fell off the end of the
 * limit. Staying put is then the least surprising thing to do; scrolling to
 * where it used to be would be showing a different commit at the same pixel.
 */
export function scrollTopFor(
    anchor: ScrollAnchor,
    rowHeight: number,
    rowOrder: readonly string[]
): number | null {
    const index = rowOrder.indexOf(anchor.hash);
    return index < 0 ? null : index * rowHeight + anchor.offset;
}
