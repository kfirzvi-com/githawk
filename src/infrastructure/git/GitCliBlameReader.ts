import { Blame } from '../../domain/models/Blame';
import { IBlameReader } from '../../domain/repositories/IBlameReader';
import { GitBlameParser } from './GitBlameParser';
import { blameArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliBlameReader implements IBlameReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async read(path: string, contents?: string): Promise<Blame> {
        return GitBlameParser.parse(
            await this.runner.run(
                blameArgs(path, { fromStdin: contents !== undefined }),
                this.cwd,
                contents
            )
        );
    }
}
