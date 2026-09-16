import * as vscode from 'vscode';
import {
    GenerateCommitMessageUseCase,
    NothingToDescribeError,
} from '../../application/usecases/GenerateCommitMessageUseCase';
import type { IGitWriter } from '../../domain/repositories/IGitWriter';
import type { ITextCommandRunner } from '../../domain/repositories/ITextCommandRunner';
import type { IWorkingTreeReader } from '../../domain/repositories/IWorkingTreeReader';
import { ActionRunner } from './ActionRunner';
import { AiTool } from './config';
import { log } from './log';

export interface CommitControllerDeps {
    createWriter: () => IGitWriter;
    createWorkingTreeReader: () => IWorkingTreeReader;
    commandRunner: ITextCommandRunner;
    /** The repository the changes belong to, and the tool's working directory. */
    repositoryRoot: () => string;
    /** Called after anything that changed the index or the history. */
    onCompleted: () => void;
}

/**
 * Assembles and makes a commit from the Changes view: staging, unstaging,
 * writing the message — by hand or by a tool — and committing.
 *
 * Every git call goes through the same ActionRunner the menus use, so the
 * confirmation rule and the failure reporting are the ones the rest of the
 * extension already has. Nothing here is destructive: unstaging leaves files
 * as they are, and a commit only ever records what was staged.
 */
export class CommitController {
    constructor(private readonly deps: CommitControllerDeps) {}

    private runner(): ActionRunner {
        return new ActionRunner(this.deps.createWriter(), this.deps.onCompleted);
    }

    async stage(paths: string[]): Promise<void> {
        if (paths.length > 0) {
            await this.runner().run({ type: 'stageFiles', paths });
        }
    }

    async unstage(paths: string[]): Promise<void> {
        if (paths.length > 0) {
            await this.runner().run({ type: 'unstageFiles', paths });
        }
    }

    async stageAll(): Promise<void> {
        await this.runner().run({ type: 'stageAll' });
    }

    /**
     * Commits what is staged. With nothing staged and something to stage, it
     * asks — the same question VS Code's own view asks — rather than either
     * refusing or quietly adding everything. Returns whether a commit was made.
     */
    async commit(message: string): Promise<boolean> {
        const trimmed = message.trim();
        if (trimmed.length === 0) {
            vscode.window.showWarningMessage(
                'Write a commit message first — git refuses an empty one.'
            );
            return false;
        }

        const status = await this.deps.createWorkingTreeReader().read();
        if (status.conflicted > 0) {
            vscode.window.showWarningMessage(
                `${status.conflicted} ${
                    status.conflicted === 1 ? 'file has' : 'files have'
                } unresolved conflicts. Resolve and stage them before committing.`
            );
            return false;
        }

        if (status.staged === 0) {
            if (status.unstaged === 0 && status.untracked === 0) {
                vscode.window.showInformationMessage(
                    'Nothing to commit — the working tree is clean.'
                );
                return false;
            }

            const stageAll = 'Stage all and commit';
            const answer = await vscode.window.showWarningMessage(
                'Nothing is staged. Stage every change and commit them all?',
                {
                    modal: true,
                    detail: `${describeUnstaged(status.unstaged, status.untracked)} would be added to this commit.`,
                },
                stageAll
            );
            if (answer !== stageAll) {
                return false;
            }
            if (!(await this.runner().run({ type: 'stageAll' }))) {
                return false;
            }
        }

        const committed = await this.runner().run({
            type: 'commit',
            message: trimmed,
        });
        if (committed) {
            vscode.window.setStatusBarMessage(
                `Committed: ${trimmed.split('\n')[0]}`,
                4000
            );
        }
        return committed;
    }

    /**
     * Asks a tool for a message describing what a commit would contain right
     * now — the staged changes when there are any, otherwise everything, to
     * match what `commit` itself would offer to do. Cancellable, because a
     * CLI that is waiting on a login prompt it cannot show would otherwise
     * hang the button for three minutes.
     */
    async generate(
        tool: AiTool & { commitMessageCommand: string }
    ): Promise<string | undefined> {
        const reader = this.deps.createWorkingTreeReader();
        const status = await reader.read();
        const scope = status.staged > 0 ? 'staged' : 'all';

        const useCase = new GenerateCommitMessageUseCase(
            reader,
            this.deps.commandRunner
        );

        try {
            const message = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `${tool.name} is writing a commit message…`,
                    cancellable: true,
                },
                (_progress, token) => {
                    const controller = new AbortController();
                    token.onCancellationRequested(() => controller.abort());
                    return useCase.execute({
                        command: tool.commitMessageCommand,
                        cwd: this.deps.repositoryRoot(),
                        scope,
                        signal: controller.signal,
                    });
                }
            );
            log.info(`${tool.name} wrote a commit message (${scope})`);
            return message;
        } catch (error) {
            const description =
                error instanceof Error ? error.message : String(error);
            if (error instanceof NothingToDescribeError) {
                vscode.window.showInformationMessage(description);
                return undefined;
            }
            if (/cancelled/i.test(description)) {
                return undefined;
            }

            log.warn(
                `${tool.name} could not write a commit message: ${description}`
            );
            const choice = await vscode.window.showErrorMessage(
                `${tool.name} could not write a commit message.`,
                {
                    detail: `${description}\n\nThe command was: ${tool.commitMessageCommand}\nChange it under gitHawk.aiTools if the tool is installed somewhere else, or needs different flags to run non-interactively.`,
                    modal: false,
                },
                'Show log',
                'Open settings'
            );
            if (choice === 'Show log') {
                log.show();
            } else if (choice === 'Open settings') {
                void vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'gitHawk.aiTools'
                );
            }
            return undefined;
        }
    }
}

function describeUnstaged(unstaged: number, untracked: number): string {
    const parts: string[] = [];
    if (unstaged > 0) {
        parts.push(`${unstaged} modified ${unstaged === 1 ? 'file' : 'files'}`);
    }
    if (untracked > 0) {
        parts.push(`${untracked} untracked ${untracked === 1 ? 'file' : 'files'}`);
    }
    return parts.join(' and ');
}
