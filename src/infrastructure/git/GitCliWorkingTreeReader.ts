import { WorkingTreeStatus } from '../../domain/models/WorkingTreeStatus';
import { IWorkingTreeReader } from '../../domain/repositories/IWorkingTreeReader';
import { GitStatusParser } from './GitStatusParser';
import { statusArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliWorkingTreeReader implements IWorkingTreeReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async read(): Promise<WorkingTreeStatus> {
        return GitStatusParser.parse(
            await this.runner.run(statusArgs(), this.cwd)
        );
    }
}
