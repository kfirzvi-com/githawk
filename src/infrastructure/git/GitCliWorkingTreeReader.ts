import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkingTreeStatus } from '../../domain/models/WorkingTreeStatus';
import {
    IWorkingTreeReader,
    PatchScope,
} from '../../domain/repositories/IWorkingTreeReader';
import { GitStatusParser } from './GitStatusParser';
import { statusArgs } from './gitCommands';
import { patchArgs, untrackedFilesArgs } from './gitDiffCommands';
import { ExecFileGitRunner, GitRunner } from './GitRunner';

/**
 * An untracked file larger than this is named in the patch but not quoted:
 * the patch is read by whoever writes the commit message, and a generated
 * asset or a lockfile tells them nothing that its name does not.
 */
const UNTRACKED_QUOTE_LIMIT_BYTES = 64 * 1024;

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

    async patch(scope: PatchScope): Promise<string> {
        const tracked = await this.runner.run(patchArgs(scope), this.cwd);
        if (scope === 'staged') {
            return tracked;
        }

        /*
         * `git diff --no-index /dev/null <file>` would do this, but it exits
         * 1 whenever the two differ — which is always — and the runner
         * rightly treats a non-zero exit as failure. Reading the file is
         * simpler than teaching the runner about one command's exit codes.
         */
        const untracked = (await this.runner.run(untrackedFilesArgs(), this.cwd))
            .split('\0')
            .filter((path) => path.length > 0)
            .sort();
        const additions = await Promise.all(
            untracked.map((path) => this.describeUntracked(path))
        );

        return [tracked, ...additions].filter((part) => part.length > 0).join('\n');
    }

    /** A new-file diff, the way git itself would print one. */
    private async describeUntracked(path: string): Promise<string> {
        const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n`;

        let bytes: Buffer;
        try {
            bytes = await readFile(join(this.cwd, path));
        } catch {
            // Deleted between the listing and the read, or unreadable.
            return `${header}(could not be read)\n`;
        }

        if (bytes.length > UNTRACKED_QUOTE_LIMIT_BYTES) {
            return `${header}(${bytes.length} bytes, not shown)\n`;
        }
        if (bytes.subarray(0, 8192).includes(0)) {
            return `${header}Binary file\n`;
        }

        const lines = bytes.toString('utf8').replace(/\n$/, '').split('\n');
        return `${header}@@ -0,0 +1,${lines.length} @@\n${lines
            .map((line) => `+${line}`)
            .join('\n')}\n`;
    }
}
