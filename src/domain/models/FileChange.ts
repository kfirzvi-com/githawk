export type ChangeStatus =
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'typeChanged';

export interface FileChange {
    /** Path as of the newer side of the comparison. */
    path: string;
    /** Set for renames and copies only. */
    previousPath?: string;
    status: ChangeStatus;
    insertions: number;
    deletions: number;
    /** Binary files report no line counts, which is different from reporting zero. */
    isBinary: boolean;
}

export interface ComparisonTotals {
    files: number;
    insertions: number;
    deletions: number;
    binaryFiles: number;
}

export function totalsFor(changes: FileChange[]): ComparisonTotals {
    return changes.reduce<ComparisonTotals>(
        (totals, change) => ({
            files: totals.files + 1,
            insertions: totals.insertions + change.insertions,
            deletions: totals.deletions + change.deletions,
            binaryFiles: totals.binaryFiles + (change.isBinary ? 1 : 0),
        }),
        { files: 0, insertions: 0, deletions: 0, binaryFiles: 0 }
    );
}

/** Largest changes first, so a review starts where the substance is. */
export function bySizeDescending(a: FileChange, b: FileChange): number {
    const weight = (c: FileChange) => c.insertions + c.deletions;
    const delta = weight(b) - weight(a);
    return delta !== 0 ? delta : a.path.localeCompare(b.path);
}
