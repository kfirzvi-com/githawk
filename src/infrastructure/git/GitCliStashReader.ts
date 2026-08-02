import { Stash } from '../../domain/models/Stash';
import { IStashReader } from '../../domain/repositories/IStashReader';
import { GitStashParser } from './GitStashParser';
import { stashListArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliStashReader implements IStashReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async list(): Promise<Stash[]> {
        return GitStashParser.parse(
            await this.runner.run(stashListArgs(), this.cwd)
        );
    }
}
