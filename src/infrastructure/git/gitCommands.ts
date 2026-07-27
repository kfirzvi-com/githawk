/**
 * Command construction, kept pure so the exact arguments can be asserted in
 * tests without spawning anything.
 *
 * Fields are separated by ASCII US (0x1f) and records by ASCII RS (0x1e).
 * Newlines are unusable as separators because a commit subject can contain
 * almost anything; these two control characters cannot appear in a ref name and
 * will not survive into a subject in practice.
 *
 * Built from char codes deliberately. A literal control character here is
 * invisible in every editor and diff, survives refactoring only by luck, and its
 * failure mode is a parser that silently returns zero commits.
 */
export const UNIT_SEPARATOR = String.fromCharCode(0x1f);
export const RECORD_SEPARATOR = String.fromCharCode(0x1e);

/**
 * hash, parents, author name, author email, author date, committer name,
 * committer date, ref decorations, then the raw message.
 *
 * `%B` is last on purpose: it is the only field that can contain newlines, and
 * keeping it at the end means a multi-line message cannot be mistaken for the
 * start of another field. Records are still delimited by RS, so newlines inside
 * it are harmless.
 */
export const LOG_FORMAT =
    ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%cI', '%D', '%B'].join('%x1f') +
    '%x1e';

export interface LogOptions {
    /** Maximum commits to display. One extra is requested so truncation is detectable. */
    limit: number;
}

export function logArgs({ limit }: LogOptions): string[] {
    return [
        'log',
        // Every ref, not just HEAD — a graph showing one branch is not a graph.
        '--all',
        // Parents before children within the page git returns.
        '--topo-order',
        '--no-color',
        // Full ref paths in %D, so a branch, a tag, and a remote are
        // distinguishable. Short names alone cannot tell `v1.0` from `main`.
        '--decorate=full',
        // One extra distinguishes "exactly `limit` commits" from "more exist".
        `--max-count=${limit + 1}`,
        `--format=${LOG_FORMAT}`,
    ];
}

export function branchArgs(): string[] {
    return [
        'for-each-ref',
        `--format=%(refname)${UNIT_SEPARATOR}%(objectname)${UNIT_SEPARATOR}%(HEAD)`,
        'refs/heads',
        'refs/remotes',
    ];
}

export function repositoryRootArgs(): string[] {
    return ['rev-parse', '--show-toplevel'];
}
