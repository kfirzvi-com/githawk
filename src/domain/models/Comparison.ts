import { FileChange } from './FileChange';

/**
 * What to compare, as data.
 *
 * The distinction between these is not cosmetic — each answers a different
 * question, and using the wrong one silently gives a misleading diff:
 *
 * - `branchAgainstBase` diffs from the *merge base*, so commits that landed on
 *   the base after you branched do not appear as if you had reverted them. This
 *   is the "show me my whole feature" case.
 * - `commitRange` is a contiguous run of history.
 * - `commitSet` is an arbitrary, possibly non-contiguous selection, which has no
 *   single "before" state in git and must be reconstructed.
 */
export type ComparisonSpec =
    | {
          kind: 'branchAgainstBase';
          base: string;
          /** Include uncommitted work, so in-progress changes are reviewable too. */
          includeWorkingTree: boolean;
      }
    /**
     * Any two revisions, directly. Unlike `branchAgainstBase` this does not use
     * the merge base: the question is "how do these two states differ?", not
     * "what did I do on top of that one?". Either side may be a branch, tag,
     * commit, or the working tree, and neither has to involve HEAD.
     */
    | { kind: 'twoRefs'; left: string; right: string; rightIsWorkingTree?: boolean }
    | { kind: 'commitRange'; oldest: string; newest: string }
    | { kind: 'singleCommit'; hash: string }
    | { kind: 'commitSet'; hashes: string[] }
    /**
     * Everything uncommitted, kept in the groups git itself keeps: what is
     * staged, what is changed but not staged, what git has never seen, and
     * what is mid-conflict. Not a `twoRefs` against the working tree, because
     * that collapses the index into the diff — a reader about to commit needs
     * to know which side of it each file is on.
     */
    | { kind: 'workingTree' };

/** How a comparison's "before" side was established, which the UI must disclose. */
export type ComparisonMethod =
    | 'mergeBase'
    /** Direct comparison of two revisions. */
    | 'direct'
    | 'range'
    | 'singleCommit'
    /** Selection replayed onto its common ancestor in a scratch worktree. */
    | 'replay'
    /** The uncommitted changeset, grouped by where each file stands. */
    | 'workingTree';

/**
 * The four places an uncommitted file can be, in the order they are shown:
 * conflicts first because they block everything else, then what will be
 * committed, then what will not, then what git does not know about.
 */
export type ChangeGroupKind = 'conflicted' | 'staged' | 'unstaged' | 'untracked';

export const changeGroupOrder: readonly ChangeGroupKind[] = [
    'conflicted',
    'staged',
    'unstaged',
    'untracked',
];

/**
 * One section of the uncommitted changeset. Each carries its own pair of
 * revisions because each answers a different question — a staged file is
 * HEAD against the index, an unstaged one is the index against the disk —
 * and a single pair for the whole comparison would open the wrong diff for
 * half of them.
 */
export interface ChangeGroup {
    kind: ChangeGroupKind;
    files: FileChange[];
    /** What the diff editor's left side reads. */
    baseRev: string;
    /** The right side; `undefined` means the file on disk. */
    targetRev?: string;
}

/**
 * Git's own name for stage 0 of the index — `git show :0:path` reads a file as
 * it is staged. Used as a revision wherever the index is one side of a diff.
 */
export const INDEX_REVISION = ':0';

export interface Comparison {
    spec: ComparisonSpec;
    method: ComparisonMethod;
    /** Human-readable description of the two sides, e.g. "main…HEAD". */
    label: string;
    /** Every changed file. With `groups`, the union of them, in group order. */
    files: FileChange[];
    /** The resolved revision the diff was taken from, for opening file contents. */
    baseRev: string;
    /** The newer side; `undefined` means the working tree. */
    targetRev?: string;
    /** Commits excluded because they could not be replayed cleanly. */
    skipped?: { hash: string; reason: string }[];
    /**
     * Present for the working tree only. Empty groups are left out, so a
     * group's presence is itself information.
     */
    groups?: ChangeGroup[];
}

export function isWorkingTreeComparison(comparison: Comparison): boolean {
    return comparison.targetRev === undefined;
}
