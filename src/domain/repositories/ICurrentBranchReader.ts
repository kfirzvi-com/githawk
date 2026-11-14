/**
 * Where a repository's HEAD is, in the words a branch picker would use: the
 * branch name, or the short hash when HEAD is detached. Undefined for a
 * repository with no commit yet and no branch to name.
 *
 * Its own port rather than a question for IGitRepository, which reads the
 * whole log to answer it: the Changes view asks this of every repository in
 * the workspace on every refresh.
 */
export interface ICurrentBranchReader {
    read(): Promise<string | undefined>;
}
