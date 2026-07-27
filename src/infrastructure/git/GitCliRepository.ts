import { GitRepository } from '../../domain/models/GitRepository';
import { IGitRepository } from '../../domain/repositories/IGitRepository';
import { GitLogParser } from './GitLogParser';
import { branchArgs, logArgs, repositoryRootArgs } from './gitCommands';
import { ExecFileGitRunner, GitError, GitRunner } from './GitRunner';

export const DEFAULT_COMMIT_LIMIT = 500;

export interface GitCliRepositoryOptions {
    /** Any path inside the working tree; the repository root is resolved from it. */
    cwd: string;
    limit?: number;
    runner?: GitRunner;
}

/** Thrown when the path is not inside a git working tree. */
export class NotAGitRepositoryError extends Error {
    constructor(readonly cwd: string) {
        super(`No git repository found at ${cwd}`);
        this.name = 'NotAGitRepositoryError';
    }
}

/**
 * Reads a real repository through the git CLI.
 *
 * Shelling out rather than using VS Code's built-in git extension API: that API
 * exposes status and refs but cannot express commit topology, which is the only
 * thing a graph needs.
 */
export class GitCliRepository implements IGitRepository {
    private readonly runner: GitRunner;
    private readonly limit: number;
    private resolvedRoot?: string;

    constructor(private readonly options: GitCliRepositoryOptions) {
        this.runner = options.runner ?? new ExecFileGitRunner();
        this.limit = options.limit ?? DEFAULT_COMMIT_LIMIT;
    }

    async getRepository(): Promise<GitRepository> {
        const root = await this.repositoryRoot();

        const [commitsOutput, branchesOutput] = await Promise.all([
            this.readCommits(root),
            this.runner.run(branchArgs(), root),
        ]);

        const branches = GitLogParser.parseBranches(branchesOutput);
        const allCommits = GitLogParser.parseCommits(commitsOutput);

        // One extra was requested; its presence is how truncation is detected.
        const hasMoreHistory = allCommits.length > this.limit;
        const commits = hasMoreHistory
            ? allCommits.slice(0, this.limit)
            : allCommits;

        return new GitRepository(commits, branches, hasMoreHistory);
    }

    /** Absolute path to the working-tree root, resolved once and cached. */
    async repositoryRoot(): Promise<string> {
        if (this.resolvedRoot) {
            return this.resolvedRoot;
        }

        try {
            const output = await this.runner.run(
                repositoryRootArgs(),
                this.options.cwd
            );
            this.resolvedRoot = output.trim();
            return this.resolvedRoot;
        } catch (error) {
            if (isNotARepository(error)) {
                throw new NotAGitRepositoryError(this.options.cwd);
            }
            throw error;
        }
    }

    private async readCommits(root: string): Promise<string> {
        try {
            return await this.runner.run(logArgs({ limit: this.limit }), root);
        } catch (error) {
            // A freshly initialised repository has no commits and no HEAD, and
            // git treats that as an error. An empty graph is the correct answer.
            if (isEmptyRepository(error)) {
                return '';
            }
            throw error;
        }
    }
}

function isNotARepository(error: unknown): boolean {
    return (
        error instanceof GitError &&
        /not a git repository|unsafe repository/i.test(error.stderr)
    );
}

function isEmptyRepository(error: unknown): boolean {
    return (
        error instanceof GitError &&
        /does not have any commits yet|bad revision|unknown revision/i.test(
            error.stderr
        )
    );
}
