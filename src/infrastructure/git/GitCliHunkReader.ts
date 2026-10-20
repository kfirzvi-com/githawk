import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hunk } from '../../domain/models/Hunk';
import { HunkRequest, IHunkReader } from '../../domain/repositories/IHunkReader';
import { fileHunksArgs } from './gitDiffCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';
import { parseUnifiedDiff, untrackedFileHunks } from './GitUnifiedDiffParser';

export class GitCliHunkReader implements IHunkReader {
    private readonly runner: GitRunner;

    constructor(
        private readonly cwd: string,
        runner?: GitRunner
    ) {
        this.runner = runner ?? new ExecFileGitRunner();
    }

    async hunks(request: HunkRequest): Promise<Hunk[]> {
        if (request.untracked) {
            const content = await readFile(join(this.cwd, request.path), 'utf8');
            return untrackedFileHunks(request.path, content);
        }
        const output = await this.runner.run(fileHunksArgs(request), this.cwd);
        return parseUnifiedDiff(request.path, output);
    }
}
