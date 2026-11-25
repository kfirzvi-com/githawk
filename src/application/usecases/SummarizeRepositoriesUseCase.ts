import type { RepositorySummary } from '../../domain/models/RepositorySummary';
import type { IRepositorySummaryReader } from '../../domain/repositories/IRepositorySummaryReader';

export interface RepositorySummaryResult {
    root: string;
    summary?: RepositorySummary;
    /** Why it could not be read: deleted, mid-clone, not a repository any more. */
    error?: string;
}

/**
 * Enough processes at once to make a workspace of many repositories quick,
 * few enough that refreshing it does not fork a git per repository at once.
 */
const DEFAULT_CONCURRENCY = 6;

/**
 * Reads the summary of each repository, in the order given.
 *
 * One repository that cannot be read is reported as such and costs only its
 * own row: the others are still worth showing.
 */
export class SummarizeRepositoriesUseCase {
    constructor(
        private readonly readerFor: (root: string) => IRepositorySummaryReader,
        private readonly concurrency = DEFAULT_CONCURRENCY
    ) {}

    async execute(roots: readonly string[]): Promise<RepositorySummaryResult[]> {
        const results: RepositorySummaryResult[] = new Array(roots.length);
        let next = 0;

        const worker = async () => {
            while (next < roots.length) {
                const index = next++;
                const root = roots[index];
                try {
                    results[index] = { root, summary: await this.readerFor(root).read() };
                } catch (error) {
                    results[index] = {
                        root,
                        error: error instanceof Error ? error.message : String(error),
                    };
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(this.concurrency, roots.length) }, worker)
        );
        return results;
    }
}
