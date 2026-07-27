/**
 * Argument builders for reading diffs. Pure, so the exact revision syntax is
 * asserted in tests — the difference between `..` and `...` is the difference
 * between an honest review and a misleading one.
 */

/** Common flags: NUL-delimited, rename detection on, no pager, no colour. */
const SHARED = ['--find-renames', '--no-color', '-z'] as const;

export function nameStatusArgs(revisions: string[]): string[] {
    return ['diff', ...SHARED, '--name-status', ...revisions, '--'];
}

export function numstatArgs(revisions: string[]): string[] {
    return ['diff', ...SHARED, '--numstat', ...revisions, '--'];
}

/**
 * The commit where the two branches diverged.
 *
 * This is what makes "show me my feature" correct. Diffing `base..HEAD`
 * two-dot compares the current tip of base against HEAD, so anything committed to
 * base after you branched shows up inverted, as though you had deleted it. From
 * the merge base, only your own work appears.
 */
export function mergeBaseArgs(base: string, target: string): string[] {
    return ['merge-base', base, target];
}

/** Contents of one path at one revision, for the diff editor's left side. */
export function showFileArgs(rev: string, path: string): string[] {
    return ['show', `${rev}:${path}`];
}

export function revParseArgs(rev: string): string[] {
    return ['rev-parse', rev];
}

/**
 * The commits reachable from `target` but not `base`, oldest first — the commits
 * that make up the work under review.
 */
export function commitsInRangeArgs(base: string, target: string): string[] {
    return ['rev-list', '--reverse', `${base}..${target}`];
}

/** Whether every listed commit forms one unbroken first-parent chain. */
export function parentsOfArgs(hashes: string[]): string[] {
    return ['rev-list', '--no-walk', '--parents', ...hashes];
}
