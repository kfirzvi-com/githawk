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
    | { kind: 'commitRange'; oldest: string; newest: string }
    | { kind: 'singleCommit'; hash: string }
    | { kind: 'commitSet'; hashes: string[] };

/** How a comparison's "before" side was established, which the UI must disclose. */
export type ComparisonMethod =
    | 'mergeBase'
    | 'range'
    | 'singleCommit'
    /** Selection replayed onto its common ancestor in a scratch worktree. */
    | 'replay';

export interface Comparison {
    spec: ComparisonSpec;
    method: ComparisonMethod;
    /** Human-readable description of the two sides, e.g. "main…HEAD". */
    label: string;
    files: FileChange[];
    /** The resolved revision the diff was taken from, for opening file contents. */
    baseRev: string;
    /** The newer side; `undefined` means the working tree. */
    targetRev?: string;
    /** Commits excluded because they could not be replayed cleanly. */
    skipped?: { hash: string; reason: string }[];
}

export function isWorkingTreeComparison(comparison: Comparison): boolean {
    return comparison.targetRev === undefined;
}
