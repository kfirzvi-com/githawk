import { Comparison, ComparisonSpec } from '../models/Comparison';

/**
 * Reads diffs. Separate from IGitRepository because comparing is a different
 * question from drawing the graph, and separate from IGitWriter because it must
 * never mutate anything.
 */
export interface IComparisonReader {
    compare(spec: ComparisonSpec): Promise<Comparison>;

    /** File contents at a revision, for the diff editor. */
    fileContentAt(rev: string, path: string): Promise<string>;
}
