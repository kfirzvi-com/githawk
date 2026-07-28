import { Worktree } from '../../domain/models/Worktree';
import { IWorktreeReader } from '../../domain/repositories/IWorktreeReader';
import { GitWorktreeParser } from './GitWorktreeParser';
import { repositoryRootArgs, worktreeListArgs } from './gitCommands';
import { ExecFileGitRunner, GitError, GitRunner } from './GitRunner';

export class GitCliWorktreeReader implements IWorktreeReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async list(): Promise<Worktree[]> {
        /*
         * The current path comes from git rather than from the caller's cwd, so
         * that it is directly comparable to the paths in the listing. Git
         * resolves symlinks in both — on macOS a workspace opened at /tmp/x is
         * /private/tmp/x to git — and a string comparison between the two forms
         * would silently never match.
         */
        const [listing, currentPath] = await Promise.all([
            this.runner.run(worktreeListArgs(), this.cwd),
            this.currentWorktreePath(),
        ]);

        return GitWorktreeParser.parse(listing, currentPath);
    }

    private async currentWorktreePath(): Promise<string | undefined> {
        try {
            return (
                await this.runner.run(repositoryRootArgs(), this.cwd)
            ).trim();
        } catch (error) {
            // A bare repository has no working tree, so --show-toplevel fails.
            // The listing is still meaningful; nothing is marked current.
            if (error instanceof GitError) {
                return undefined;
            }
            throw error;
        }
    }
}
