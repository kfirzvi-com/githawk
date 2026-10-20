import { Hunk } from '../models/Hunk';

/** One file of a comparison, as its row in the Changes view knows it. */
export interface HunkRequest {
    path: string;
    /** Set for a rename, so the older side is read under its older name. */
    previousPath?: string;
    /** The older side. `:0` is the index; see INDEX_REVISION. */
    baseRev: string;
    /** The newer side; absent means the file on disk. `:0` is the index. */
    targetRev?: string;
    /** A file git has never seen: there is no older side, only the file. */
    untracked?: boolean;
}

/**
 * Reads the blocks a file's diff is made of. Separate from IComparisonReader
 * because that one answers "which files", once per comparison, and this one
 * answers "which lines", once per file and only while something is reviewing
 * them.
 */
export interface IHunkReader {
    /** Empty for a binary file, or one whose change has no lines in it. */
    hunks(request: HunkRequest): Promise<Hunk[]>;
}
