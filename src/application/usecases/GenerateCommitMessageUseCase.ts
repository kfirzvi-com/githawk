import type { ITextCommandRunner } from '../../domain/repositories/ITextCommandRunner';
import type {
    IWorkingTreeReader,
    PatchScope,
} from '../../domain/repositories/IWorkingTreeReader';
import {
    cleanGeneratedMessage,
    commitMessagePrompt,
} from '../services/commitMessage';

export interface GenerateCommitMessageRequest {
    /** The tool's command line, from the reader's settings. */
    command: string;
    cwd: string;
    scope: PatchScope;
    signal?: AbortSignal;
}

/** Raised when there is no change for a message to describe. */
export class NothingToDescribeError extends Error {
    constructor(scope: PatchScope) {
        super(
            scope === 'staged'
                ? 'Nothing is staged, so there is nothing to describe.'
                : 'The working tree is clean, so there is nothing to describe.'
        );
        this.name = 'NothingToDescribeError';
    }
}

/** Raised when the tool ran but printed nothing usable. */
export class EmptyMessageError extends Error {
    constructor() {
        super('The tool returned nothing that reads as a commit message.');
        this.name = 'EmptyMessageError';
    }
}

/**
 * Asks a configured AI CLI for a commit message.
 *
 * The diff goes to the tool on stdin, never on its command line — a shell
 * would choke on it, and the reader's command is run exactly as written. What
 * comes back is tidied but not judged: the message lands in the box for the
 * reader to edit, and nothing is committed on the strength of it.
 */
export class GenerateCommitMessageUseCase {
    constructor(
        private readonly workingTree: IWorkingTreeReader,
        private readonly runner: ITextCommandRunner
    ) {}

    async execute(request: GenerateCommitMessageRequest): Promise<string> {
        const patch = await this.workingTree.patch(request.scope);
        if (patch.trim().length === 0) {
            throw new NothingToDescribeError(request.scope);
        }

        const output = await this.runner.run({
            command: request.command,
            input: commitMessagePrompt(patch, request.scope),
            cwd: request.cwd,
            signal: request.signal,
        });

        const message = cleanGeneratedMessage(output);
        if (message.length === 0) {
            throw new EmptyMessageError();
        }
        return message;
    }
}
