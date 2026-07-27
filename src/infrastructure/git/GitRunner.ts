import { execFile } from 'node:child_process';

export class GitError extends Error {
    constructor(
        message: string,
        readonly args: string[],
        readonly stderr: string,
        readonly exitCode: number | null
    ) {
        super(message);
        this.name = 'GitError';
    }
}

export interface GitRunner {
    run(args: string[], cwd: string): Promise<string>;
}

/**
 * Runs git via execFile with an argument array — never a shell string. Branch
 * names, paths, and refs are attacker-influenced in the general case (a cloned
 * repository can contain a branch called `; rm -rf ~`), and an argument array
 * removes shell interpretation entirely.
 */
export class ExecFileGitRunner implements GitRunner {
    constructor(
        private readonly gitPath = 'git',
        /**
         * Default maxBuffer is 1 MB, which a few thousand commits overruns —
         * and the resulting failure looks like a git error rather than a buffer
         * limit, so it is worth being explicit.
         */
        private readonly maxBuffer = 128 * 1024 * 1024,
        private readonly timeoutMs = 30_000
    ) {}

    run(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile(
                this.gitPath,
                args,
                {
                    cwd,
                    maxBuffer: this.maxBuffer,
                    timeout: this.timeoutMs,
                    windowsHide: true,
                    // Keep output stable regardless of the user's locale and config.
                    env: {
                        ...process.env,
                        LC_ALL: 'C',
                        GIT_OPTIONAL_LOCKS: '0',
                    },
                },
                (error, stdout, stderr) => {
                    if (error) {
                        const code =
                            typeof (error as { code?: unknown }).code === 'number'
                                ? ((error as { code: number }).code)
                                : null;
                        reject(
                            new GitError(
                                stderr.trim() || error.message,
                                args,
                                stderr.trim(),
                                code
                            )
                        );
                        return;
                    }
                    resolve(stdout);
                }
            );
        });
    }
}
