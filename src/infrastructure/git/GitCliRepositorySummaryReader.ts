import type { RepositorySummary } from '../../domain/models/RepositorySummary';
import type { IRepositorySummaryReader } from '../../domain/repositories/IRepositorySummaryReader';
import { GitBranchStatusParser } from './GitBranchStatusParser';
import { branchStatusArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliRepositorySummaryReader implements IRepositorySummaryReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async read(): Promise<RepositorySummary> {
        return GitBranchStatusParser.parse(
            await this.runner.run(branchStatusArgs(), this.cwd)
        );
    }
}
