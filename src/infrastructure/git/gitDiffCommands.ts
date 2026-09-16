/**
 * Argument builders for reading diffs. Pure, so the exact revision syntax is
 * asserted in tests — the difference between `..` and `...` is the difference
 * between an honest review and a misleading one.
 */

/** Common flags: NUL-delimited, rename detection on, no pager, no colour. */
const SHARED = ['--find-renames', '--no-color', '-z'] as const;

export interface DiffOptions {
    /**
     * The index against the given revision (HEAD when none), rather than the
     * working tree — what `git commit` would record right now.
     */
    cached?: boolean;
}

export function nameStatusArgs(
    revisions: string[],
    options: DiffOptions = {}
): string[] {
    return [
        'diff',
        ...SHARED,
        ...(options.cached ? ['--cached'] : []),
        '--name-status',
        ...revisions,
        '--',
    ];
}

export function numstatArgs(
    revisions: string[],
    options: DiffOptions = {}
): string[] {
    return [
        'diff',
        ...SHARED,
        ...(options.cached ? ['--cached'] : []),
        '--numstat',
        ...revisions,
        '--',
    ];
}

/**
 * Files git does not track and is not told to ignore. `--exclude-standard`
 * honours .gitignore, the repository's info/exclude and the global excludes,
 * which is the same rule `git status` applies — without it every build
 * artefact in the tree would be offered for commit.
 */
export function untrackedFilesArgs(): string[] {
    return ['ls-files', '--others', '--exclude-standard', '-z'];
}

/**
 * A unified diff as text, for reading rather than parsing. `staged` is what a
 * commit would record; `all` is every tracked change against HEAD, staged or
 * not. Untracked files are in neither — git has no blob to diff them against
 * — so a caller that wants them has to read them itself.
 */
export function patchArgs(scope: 'staged' | 'all'): string[] {
    return scope === 'staged'
        ? ['diff', '--no-color', '--cached', '--']
        : ['diff', '--no-color', 'HEAD', '--'];
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
