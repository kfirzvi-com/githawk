import { WorkingTreeStatus } from '../models/WorkingTreeStatus';

/** Which part of the uncommitted work a patch should describe. */
export type PatchScope = 'staged' | 'all';

export interface IWorkingTreeReader {
    read(): Promise<WorkingTreeStatus>;

    /**
     * The uncommitted changes as a unified diff, for a reader — human or
     * model — rather than a parser. `staged` is exactly what a commit would
     * record; `all` is every change, including files git has never seen,
     * which a plain `git diff` cannot show and so are appended as new files.
     */
    patch(scope: PatchScope): Promise<string>;
}
