import { IRevisionTreeReader } from '../../domain/repositories/IRevisionTreeReader';
import { lsTreeArgs, resolveRevisionArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliTreeReader implements IRevisionTreeReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async resolve(rev: string): Promise<string> {
        return (await this.runner.run(resolveRevisionArgs(rev), this.cwd)).trim();
    }

    async listPaths(rev: string): Promise<string[]> {
        const output = await this.runner.run(lsTreeArgs(rev), this.cwd);
        return output.split('\0').filter((path) => path.length > 0);
    }
}
