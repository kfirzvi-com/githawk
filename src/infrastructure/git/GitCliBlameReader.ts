import { Blame } from '../../domain/models/Blame';
import {
    BlameRequest,
    IBlameReader,
} from '../../domain/repositories/IBlameReader';
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

    async read({ path, contents, rev }: BlameRequest): Promise<Blame> {
        return GitBlameParser.parse(
            await this.runner.run(
                blameArgs(path, {
                    fromStdin: contents !== undefined,
                    rev,
                }),
                this.cwd,
                contents
            )
        );
    }
}
