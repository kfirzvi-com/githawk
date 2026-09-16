/**
 * Runs a command the user configured — an AI CLI, in practice — feeding it
 * text on stdin and returning what it printed.
 *
 * A port rather than a direct spawn so the use case that builds the prompt
 * and cleans the answer is testable with a fake, and so the one place that
 * touches a shell is small enough to read in full.
 */
export interface ITextCommandRunner {
    run(request: TextCommandRequest): Promise<string>;
}

export interface TextCommandRequest {
    /** The command line, exactly as the user wrote it in settings. */
    command: string;
    /** Written to the process's stdin, then closed. */
    input: string;
    cwd: string;
    /** Lets the caller stop a tool that is taking too long. */
    signal?: AbortSignal;
}
