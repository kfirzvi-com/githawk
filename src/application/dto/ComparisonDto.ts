import { ComparisonMethod } from '../../domain/models/Comparison';
import { ChangeStatus, ComparisonTotals } from '../../domain/models/FileChange';

export interface FileChangeDto {
    path: string;
    previousPath?: string;
    status: ChangeStatus;
    insertions: number;
    deletions: number;
    isBinary: boolean;
}

export interface ComparisonDto {
    label: string;
    method: ComparisonMethod;
    /** Stated in the UI, because how the "before" side was derived changes what the numbers mean. */
    methodExplanation: string;
    files: FileChangeDto[];
    totals: ComparisonTotals;
    baseRev: string;
    targetRev?: string;
    skipped: { hash: string; reason: string }[];
}
