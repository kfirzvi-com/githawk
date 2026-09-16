import {
    ChangeGroupKind,
    ComparisonMethod,
} from '../../domain/models/Comparison';
import { ChangeStatus, ComparisonTotals } from '../../domain/models/FileChange';

export interface FileChangeDto {
    path: string;
    previousPath?: string;
    status: ChangeStatus;
    insertions: number;
    deletions: number;
    isBinary: boolean;
}

/** One section of the uncommitted changeset; see ChangeGroup in the domain. */
export interface ChangeGroupDto {
    kind: ChangeGroupKind;
    files: FileChangeDto[];
    baseRev: string;
    targetRev?: string;
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
    /** Present for the working tree only: the same files, by where they stand. */
    groups?: ChangeGroupDto[];
}
