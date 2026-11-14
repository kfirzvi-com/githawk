import type { ICurrentBranchReader } from '../../domain/repositories/ICurrentBranchReader';
import { currentBranchArgs, shortHeadArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliCurrentBranchReader implements ICurrentBranchReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async read(): Promise<string | undefined> {
        try {
            const branch = (await this.runner.run(currentBranchArgs(), this.cwd)).trim();
            if (branch) {
                return branch;
            }
            // Detached: the commit is the only name HEAD has.
            const hash = (await this.runner.run(shortHeadArgs(), this.cwd)).trim();
            return hash || undefined;
        } catch {
            // No commit yet, or not a repository: there is nothing to name.
            return undefined;
        }
    }
}
