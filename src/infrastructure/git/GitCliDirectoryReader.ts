import { join } from 'node:path';
import {
    GitDirectories,
    IGitDirectoryReader,
} from '../../domain/repositories/IGitDirectoryReader';
import { gitDirectoriesArgs } from './gitCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

export class GitCliDirectoryReader implements IGitDirectoryReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async read(): Promise<GitDirectories> {
        try {
            const [gitDir, commonDir] = (
                await this.runner.run(gitDirectoriesArgs(), this.cwd)
            )
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            if (gitDir && commonDir) {
                return { gitDir, commonDir };
            }
        } catch {
            // Falls through to the assumption below.
        }

        /*
         * `--path-format` needs git 2.31 (2021), and the whole command fails on
         * a directory that is not a repository. Neither is worth failing over:
         * the only caller watches these paths, and an ordinary checkout — which
         * is what an old git is overwhelmingly likely to be looking at — keeps
         * everything in `<root>/.git`. A linked worktree on such a git gets no
         * automatic refresh rather than a broken one.
         */
        const assumed = join(this.cwd, '.git');
        return { gitDir: assumed, commonDir: assumed };
    }
}
