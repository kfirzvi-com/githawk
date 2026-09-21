/**
 * Reads what a revision contains, as opposed to what it changed. Separate from
 * IComparisonReader because "every file at this commit" is a different
 * question from "which files differ", and from IGitWriter because it must
 * never mutate anything.
 */
export interface IRevisionTreeReader {
    /** The full hash a branch, tag, or abbreviated hash names. Rejects when it names nothing. */
    resolve(rev: string): Promise<string>;

    /** Every tracked path at the revision, repository-relative, in git's order. */
    listPaths(rev: string): Promise<string[]>;
}
