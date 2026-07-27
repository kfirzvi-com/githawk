import { GitAction } from '../../domain/models/GitAction';
import { IGitWriter } from '../../domain/repositories/IGitWriter';
import { argsFor } from './gitActionCommands';
import { ExecFileGitRunner, GitError, GitRunner } from './GitRunner';

/** Raised when git refuses an operation, carrying git's own explanation. */
export class GitActionFailedError extends Error {
    constructor(
        readonly action: GitAction,
        readonly gitMessage: string
    ) {
        super(gitMessage);
        this.name = 'GitActionFailedError';
    }
}

export class GitCliWriter implements IGitWriter {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async perform(action: GitAction): Promise<void> {
        try {
            await this.runner.run(argsFor(action), this.cwd);
        } catch (error) {
            if (error instanceof GitError) {
                // git's stderr is genuinely the most useful explanation here
                // ("would be overwritten by merge", "not fully merged"), so it is
                // surfaced rather than replaced with something vaguer.
                throw new GitActionFailedError(action, error.stderr || error.message);
            }
            throw error;
        }
    }
}
