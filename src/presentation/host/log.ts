import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

/**
 * A real log channel, not console.log.
 *
 * Added after a bug that could not be diagnosed: a comparison silently produced
 * nothing in VS Code while working in Node and in the harness, and there was no
 * record anywhere of what the host had received or attempted. An extension that
 * shells out to git needs to be able to say what it ran.
 *
 * Visible under Output → GitHawk, and honours the user's log level.
 */
export function initialiseLog(): vscode.LogOutputChannel {
    channel ??= vscode.window.createOutputChannel('GitHawk', { log: true });
    return channel;
}

export const log = {
    trace(message: string, ...args: unknown[]): void {
        channel?.trace(message, ...args);
    },
    debug(message: string, ...args: unknown[]): void {
        channel?.debug(message, ...args);
    },
    info(message: string, ...args: unknown[]): void {
        channel?.info(message, ...args);
    },
    warn(message: string, ...args: unknown[]): void {
        channel?.warn(message, ...args);
    },
    error(message: string, error?: unknown): void {
        channel?.error(message, describe(error));
    },
    show(): void {
        channel?.show();
    },
};

function describe(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}\n${error.stack ?? ''}`;
    }
    return String(error);
}
