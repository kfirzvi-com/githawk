import { spawn } from 'node:child_process';
import {
    ITextCommandRunner,
    TextCommandRequest,
} from '../../domain/repositories/ITextCommandRunner';

/**
 * Raised when the command exits non-zero or cannot be started, carrying the
 * end of its stderr — which for a CLI is usually the whole explanation.
 */
export class CommandFailedError extends Error {
    constructor(
        readonly command: string,
        readonly exitCode: number | null,
        readonly stderr: string
    ) {
        super(
            stderr.trim() ||
                (exitCode === null
                    ? `${command} did not finish`
                    : `${command} exited with code ${exitCode}`)
        );
        this.name = 'CommandFailedError';
    }
}

/**
 * Runs a command line through the user's shell.
 *
 * Through a shell on purpose, and in deliberate contrast to every git call in
 * this codebase, which is an argument array. Those arguments come from the
 * repository — a branch can be called anything — and must never be
 * interpreted. This command comes from the user's own settings, the same
 * string GitHawk already types into a terminal for them, and "works like the
 * terminal" is the whole promise: aliases, `npx …`, a wrapper script, a
 * pipeline. Only the command goes to the shell; the diff goes on stdin.
 */
export class ShellCommandRunner implements ITextCommandRunner {
    constructor(
        /** The shell to run under; the user's default, when the host knows it. */
        private readonly shell: string | undefined,
        private readonly timeoutMs = 180_000
    ) {}

    run(request: TextCommandRequest): Promise<string> {
        return new Promise((resolve, reject) => {
            const child =
                process.platform === 'win32' || !this.shell
                    ? spawn(request.command, {
                          cwd: request.cwd,
                          shell: true,
                          env: environment(),
                          windowsHide: true,
                      })
                    : spawn(this.shell, ['-c', request.command], {
                          cwd: request.cwd,
                          env: environment(),
                      });

            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let settled = false;
            const settle = (outcome: () => void) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    request.signal?.removeEventListener('abort', onAbort);
                    outcome();
                }
            };

            const onAbort = () => {
                child.kill();
                settle(() =>
                    reject(new CommandFailedError(request.command, null, 'cancelled'))
                );
            };
            request.signal?.addEventListener('abort', onAbort);

            const timer = setTimeout(() => {
                child.kill();
                settle(() =>
                    reject(
                        new CommandFailedError(
                            request.command,
                            null,
                            `gave up after ${Math.round(this.timeoutMs / 1000)} seconds`
                        )
                    )
                );
            }, this.timeoutMs);

            child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
            child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
            child.on('error', (error) =>
                settle(() =>
                    reject(new CommandFailedError(request.command, null, error.message))
                )
            );
            child.on('close', (code) =>
                settle(() => {
                    const err = Buffer.concat(stderr).toString('utf8');
                    if (code !== 0) {
                        reject(new CommandFailedError(request.command, code, tail(err)));
                        return;
                    }
                    resolve(Buffer.concat(stdout).toString('utf8'));
                })
            );

            // Errors are swallowed for the reason GitRunner swallows them: a
            // tool that closes stdin early raises EPIPE, and `close` above
            // still reports whatever actually went wrong.
            child.stdin?.on('error', () => {});
            child.stdin?.end(request.input);
        });
    }
}

/**
 * The host's environment, minus the marker Claude Code sets in any terminal
 * it started. VS Code launched from inside a Claude Code session inherits it,
 * and `claude -p` then refuses to run "nested" — which from the reader's seat
 * is a Generate button that fails for no visible reason.
 */
function environment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    return env;
}

/** The last few lines: where a CLI puts the sentence that matters. */
function tail(text: string, lines = 6): string {
    return text.trim().split('\n').slice(-lines).join('\n');
}
