import { Remote } from '../../domain/models/Remote';
import { IRemoteReader } from '../../domain/repositories/IRemoteReader';
import { GitRemoteParser } from './GitRemoteParser';
import { remoteListArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliRemoteReader implements IRemoteReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async list(): Promise<Remote[]> {
        return GitRemoteParser.parse(
            await this.runner.run(remoteListArgs(), this.cwd)
        );
    }
}
