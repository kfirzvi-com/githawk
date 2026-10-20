/**
 * One block of a file's diff — git's `@@ -a,b +c,d @@` section.
 *
 * The unit a review marks as viewed, because it is the unit a reader actually
 * reads: a file of forty changes is not reviewed in one glance, and pretending
 * it is is how the thirty-ninth slips through.
 */
export interface Hunk {
    /** Stable across line shifts; changes when the hunk's own content does. See hunkId. */
    id: string;
    /** First line on the older side, 1-based. 0 when the file did not exist. */
    oldStart: number;
    oldLines: number;
    /** First line on the newer side, 1-based. 0 when the file no longer exists. */
    newStart: number;
    newLines: number;
    /** What git prints after the second `@@`: usually the enclosing function. */
    context: string;
    /** The body, each line still carrying its ` `, `+` or `-` marker. */
    lines: string[];
}

export function hunkInsertions(hunk: Hunk): number {
    return hunk.lines.filter((line) => line.startsWith('+')).length;
}

export function hunkDeletions(hunk: Hunk): number {
    return hunk.lines.filter((line) => line.startsWith('-')).length;
}

/**
 * The line on the newer side a reader should be put on: the first changed
 * line, not the first line of context above it. A hunk that only deletes
 * lands where the deleted lines used to be.
 */
export function hunkFocusLine(hunk: Hunk): number {
    let line = hunk.newStart;
    for (const body of hunk.lines) {
        if (body.startsWith('+') || body.startsWith('-')) {
            return Math.max(line, 1);
        }
        line += 1;
    }
    return Math.max(hunk.newStart, 1);
}

/** The newer side's lines, inclusive, as the editor numbers them (1-based). */
export function hunkNewRange(hunk: Hunk): { start: number; end: number } {
    const start = Math.max(hunk.newStart, 1);
    return { start, end: Math.max(start, hunk.newStart + hunk.newLines - 1) };
}

/** The older side's lines, inclusive, 1-based. */
export function hunkOldRange(hunk: Hunk): { start: number; end: number } {
    const start = Math.max(hunk.oldStart, 1);
    return { start, end: Math.max(start, hunk.oldStart + hunk.oldLines - 1) };
}

/**
 * Identifies a hunk by what it says rather than where it is.
 *
 * The line numbers are left out on purpose: an edit above a reviewed hunk
 * moves it down the file without changing a word of it, and asking the reader
 * to look at it again would make "viewed" mean nothing. Anything inside it
 * changing — the case where looking again is the point — changes the id.
 *
 * `occurrence` separates two hunks of identical text in one file, which
 * repetitive code produces more often than it seems it should.
 */
export function hunkId(path: string, lines: readonly string[], occurrence = 0): string {
    return `${fnv1a(`${path}\0${lines.join('\n')}`)}${occurrence > 0 ? `-${occurrence}` : ''}`;
}

/**
 * FNV-1a, 32-bit, as hex. Not cryptographic and not meant to be: it only has
 * to tell one hunk of one file from another, and it has to run in the
 * webview as well as in Node, which rules out `crypto`.
 */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
