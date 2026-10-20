import * as vscode from 'vscode';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
    commandWithPrompt,
    reviewDocument,
    reviewPrompt,
} from '../../application/services/reviewHandoff';
import { markSent, unsentComments, type Review } from '../../domain/models/Review';
import { aiTools, type AiTool } from './config';
import { log } from './log';
import { keys, type ReviewController } from './ReviewController';

/** Where the handoff goes, chosen in the picker or named by a test. */
export type HandoffTarget =
    | { kind: 'new'; tool: AiTool }
    | { kind: 'existing'; terminal: vscode.Terminal };

export interface HandoffResult {
    documentPath: string;
    prompt: string;
    terminal: string;
    sent: number;
}

/**
 * Hands a review's comments to a coding agent: a new session of one of the
 * configured AI CLIs, or one already running in a terminal — usually the one
 * that wrote the change being reviewed, which is the session that knows why.
 *
 * Which tools exist is the `gitHawk.aiTools` setting's business, not this
 * file's: nothing here knows one tool from another.
 */
export class ReviewHandoff {
    constructor(
        private readonly reviews: ReviewController,
        private readonly deps: {
            /** A repository's git directory, where the review document is written. */
            gitDirectory: (root: string) => Promise<string>;
        }
    ) {}

    /** The review on screen, or the one named — a Reviews row sends its own. */
    async send(
        target?: { tool?: string; terminal?: string; resend?: boolean; review?: string }
    ): Promise<HandoffResult | undefined> {
        const review = target?.review
            ? this.reviews.reviewById(target.review)
            : this.reviews.current;
        const root = review?.root;
        if (!review || !root) {
            vscode.window.showInformationMessage(
                `No review in progress. Start one from the Changes view, or with ${keys('⇧R')}.`
            );
            return undefined;
        }

        const comments = await this.commentsToSend(review, target?.resend);
        if (!comments) {
            return undefined;
        }

        const destination = await this.destination(target);
        if (!destination) {
            return undefined;
        }

        const documentPath = join(await this.deps.gitDirectory(root), 'githawk', 'review.md');
        await mkdir(dirname(documentPath), { recursive: true });
        await writeFile(documentPath, reviewDocument({ ...review, comments }), 'utf8');
        const prompt = reviewPrompt(documentPath, comments.length);

        let terminal: vscode.Terminal;
        if (destination.kind === 'new') {
            const { tool } = destination;
            terminal = vscode.window.createTerminal({
                name: `${tool.name} — review`,
                cwd: vscode.Uri.file(root),
                iconPath: new vscode.ThemeIcon('sparkle'),
            });
            terminal.show();
            if (tool.promptCommand) {
                terminal.sendText(commandWithPrompt(tool.promptCommand, prompt));
            } else {
                // No way to hand it a first message: start it, and type the
                // message after. The terminal holds the keystrokes until the
                // tool is ready to read them.
                terminal.sendText(tool.command);
                terminal.sendText(prompt);
            }
        } else {
            terminal = destination.terminal;
            terminal.show();
            terminal.sendText(prompt, true);
        }

        await this.reviews.updateReview(review.id, (current) =>
            markSent(
                current,
                comments.map((comment) => comment.id),
                new Date()
            )
        );
        log.info(`sent ${comments.length} review comments to "${terminal.name}" via ${documentPath}`);
        vscode.window.setStatusBarMessage(
            `GitHawk: sent ${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} to ${terminal.name}`,
            5000
        );
        return { documentPath, prompt, terminal: terminal.name, sent: comments.length };
    }

    /**
     * What has not been sent yet — or, when everything has, everything again
     * if the reader asks for it: a session that was closed before it acted on
     * them is a reason to send the same comments twice.
     */
    private async commentsToSend(review: Review, resend?: boolean) {
        const unsent = unsentComments(review);
        if (unsent.length > 0 && !resend) {
            return unsent;
        }
        if (review.comments.length === 0) {
            vscode.window.showInformationMessage(
                `No comments yet. In a diff, put the cursor on a change and press ${keys('⇧C')}.`
            );
            return undefined;
        }
        if (resend) {
            return [...review.comments];
        }
        const again = await vscode.window.showInformationMessage(
            `All ${review.comments.length} comments were sent already.`,
            'Send Them Again'
        );
        return again ? [...review.comments] : undefined;
    }

    /**
     * Running terminals first: handing the review back to the session that
     * made the change is the usual thing to want, and it is already open.
     */
    private async destination(
        target?: { tool?: string; terminal?: string }
    ): Promise<HandoffTarget | undefined> {
        if (target?.tool) {
            const tool = aiTools().find((candidate) => candidate.name === target.tool);
            return tool ? { kind: 'new', tool } : undefined;
        }
        if (target?.terminal) {
            const terminal = vscode.window.terminals.find(
                (candidate) => candidate.name === target.terminal
            );
            return terminal ? { kind: 'existing', terminal } : undefined;
        }

        interface Item extends vscode.QuickPickItem {
            target?: HandoffTarget;
        }
        const active = vscode.window.activeTerminal;
        const terminals = [...vscode.window.terminals].sort(
            (a, b) => Number(b === active) - Number(a === active)
        );
        const items: Item[] = [];
        if (terminals.length > 0) {
            items.push({ label: 'Running sessions', kind: vscode.QuickPickItemKind.Separator });
            for (const terminal of terminals) {
                items.push({
                    label: `$(terminal) ${terminal.name}`,
                    description: terminal === active ? 'active terminal' : undefined,
                    detail: 'Type the review into this session',
                    target: { kind: 'existing', terminal },
                });
            }
        }
        items.push({ label: 'New session', kind: vscode.QuickPickItemKind.Separator });
        for (const tool of aiTools()) {
            items.push({
                label: `$(sparkle) ${tool.name}`,
                description: tool.promptCommand ?? tool.command,
                detail: 'Start it in a new terminal with the review as its first message',
                target: { kind: 'new', tool },
            });
        }

        const chosen = await vscode.window.showQuickPick(items, {
            title: 'Send the review to an AI CLI',
            placeHolder: 'A running session, or a new one',
            matchOnDescription: true,
        });
        return chosen?.target;
    }
}
