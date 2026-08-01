/**
 * What is in the working tree that is not in a commit.
 *
 * Counted by file rather than by hunk, because that is the unit the Changes
 * tree lists and the unit git's own status reports. The four categories are
 * kept apart rather than summed: "3 changes" is not an answer, and a file that
 * is both staged and modified again afterwards is genuinely two things.
 */
export interface WorkingTreeStatus {
    /** Changes added to the index, ready to commit. */
    staged: number;
    /** Tracked files changed on disk but not staged. */
    unstaged: number;
    untracked: number;
    /**
     * Files with an unresolved merge conflict. Counted separately because they
     * are the one state where the repository is mid-operation.
     */
    conflicted: number;
}

export const cleanWorkingTree: WorkingTreeStatus = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
};

export function isClean(status: WorkingTreeStatus): boolean {
    return (
        status.staged === 0 &&
        status.unstaged === 0 &&
        status.untracked === 0 &&
        status.conflicted === 0
    );
}

/**
 * The row's subtitle: only the categories that have anything in them, in the
 * order git itself reports them.
 */
export function describeWorkingTree(status: WorkingTreeStatus): string {
    const parts: string[] = [];

    if (status.conflicted > 0) {
        parts.push(`${status.conflicted} conflicted`);
    }
    if (status.staged > 0) {
        parts.push(`${status.staged} staged`);
    }
    if (status.unstaged > 0) {
        parts.push(`${status.unstaged} modified`);
    }
    if (status.untracked > 0) {
        parts.push(`${status.untracked} untracked`);
    }

    return parts.join(', ');
}
