import {
    Comparison,
    ComparisonMethod,
    ComparisonSpec,
} from '../../domain/models/Comparison';
import { totalsFor } from '../../domain/models/FileChange';
import { IComparisonReader } from '../../domain/repositories/IComparisonReader';
import { ComparisonDto } from '../dto/ComparisonDto';

export class CompareUseCase {
    constructor(private readonly reader: IComparisonReader) {}

    async execute(spec: ComparisonSpec): Promise<ComparisonDto> {
        return toDto(await this.reader.compare(spec));
    }
}

export function toDto(comparison: Comparison): ComparisonDto {
    return {
        label: comparison.label,
        method: comparison.method,
        methodExplanation: explain(comparison.method),
        files: comparison.files.map((file) => ({ ...file })),
        totals: totalsFor(comparison.files),
        baseRev: comparison.baseRev,
        targetRev: comparison.targetRev,
        skipped: comparison.skipped ?? [],
    };
}

/**
 * Surfaced in the UI on purpose. A reviewer needs to know whether they are seeing
 * a merge-base diff or a reconstruction, because the two answer different
 * questions and only one of them is history.
 */
function explain(method: ComparisonMethod): string {
    switch (method) {
        case 'mergeBase':
            return 'Compared from where the branches diverged, so work that landed on the base branch afterwards is excluded.';
        case 'direct':
            return 'A direct comparison of two revisions. Everything that differs is shown, including work done on either side independently.';
        case 'range':
            return 'Compared across a contiguous run of commits.';
        case 'singleCommit':
            return 'Changes introduced by this commit alone.';
        case 'replay':
            return 'These commits are not contiguous, so their combined effect was reconstructed by replaying them onto their common ancestor in a temporary worktree. Your working tree was not touched.';
    }
}
