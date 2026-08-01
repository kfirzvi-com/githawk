/**
 * Where a repository keeps its metadata.
 *
 * Two paths rather than one because a linked worktree splits them: `HEAD`, the
 * index, and the in-progress operation markers are per-worktree and live in
 * `.git/worktrees/<name>/`, while refs and `packed-refs` are shared and live in
 * the main `.git/`. Watching only one of them misses half the events — a commit
 * made in a worktree moves a ref in the common directory, and a checkout there
 * moves a HEAD that the common directory has never heard of.
 *
 * In an ordinary checkout the two are the same path.
 */
export interface GitDirectories {
    /** Per-worktree: HEAD, index, MERGE_HEAD and friends. */
    readonly gitDir: string;
    /** Shared across worktrees: refs/, packed-refs. */
    readonly commonDir: string;
}

export interface IGitDirectoryReader {
    read(): Promise<GitDirectories>;
}
