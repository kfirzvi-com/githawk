import * as vscode from 'vscode';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hunkNewRange, hunkOldRange } from '../../domain/models/Hunk';
import {
    addComment,
    editComment,
    removeComment,
    type ReviewComment,
} from '../../domain/models/Review';
import type { ReviewController } from './ReviewController';
import { encodeRevisionUri } from './RevisionContentProvider';
import { log } from './log';

/**
 * The start of every review comment controller's id; package.json's menus
 * match on it. The rest is unique per registration — see createController.
 */
export const REVIEW_COMMENT_CONTROLLER_ID = 'gitHawk.review';

/** A comment on screen, knowing which comment of the review it shows. */
class ShownComment implements vscode.Comment {
    mode = vscode.CommentMode.Preview;
    author = { name: 'You' };
    contextValue = 'gitHawkReviewComment';
    body: vscode.MarkdownString;
    label: string;
    /** What the body was before an edit began, for Cancel. */
    private saved: string;

    constructor(
        readonly reviewId: string,
        text: string,
        sentAt: string | undefined,
        readonly thread: vscode.CommentThread
    ) {
        this.body = new vscode.MarkdownString(text);
        this.saved = text;
        this.label = sentAt ? 'sent' : 'not sent yet';
    }

    get text(): string {
        return this.body.value;
    }

    startEditing(): void {
        this.saved = this.text;
        this.mode = vscode.CommentMode.Editing;
    }

    cancelEditing(): void {
        this.body = new vscode.MarkdownString(this.saved);
        this.mode = vscode.CommentMode.Preview;
    }
}

/**
 * Review comments, in VS Code's own commenting UI: the gutter's +, the
 * thread widget, and the Comments panel, which lists every one of them and
 * jumps to it — none of which is worth rebuilding.
 *
 * Comments live in the review, not here. This draws them, offers lines to
 * comment on — the changed lines of each hunk, on whichever side of the diff
 * the reader is looking at — and writes back what is typed.
 */
export class ReviewComments implements vscode.Disposable {
    private controller = this.createController();
    private threads: vscode.CommentThread[] = [];
    private readonly disposables: vscode.Disposable[] = [];
    /** What the threads on screen were drawn from, so a redraw happens only when it changed. */
    private drawn = '';

    constructor(
        private readonly reviews: ReviewController,
        private readonly repositoryRoot: () => string | undefined
    ) {
        this.offerRanges();
        this.disposables.push(
            reviews.onDidChange(() => {
                this.offerRanges();
                this.draw();
            })
        );
    }

    /**
     * A comment controller with an id of its own. VS Code files controllers
     * by id and extension; with a fixed id, an extension host restarted
     * mid-session — trusting a folder does it — could have the old host's
     * cleanup remove the new host's controller, after which VS Code never
     * asks for commenting ranges again and every Add Comment is refused.
     */
    private createController(): vscode.CommentController {
        const controller = vscode.comments.createCommentController(
            `${REVIEW_COMMENT_CONTROLLER_ID}.${Date.now().toString(36)}`,
            'GitHawk Review'
        );
        controller.options = {
            prompt: 'Comment on these lines',
            placeHolder:
                'A note for whoever fixes this — kept on this machine until you send the review to an AI CLI',
        };
        return controller;
    }

    /**
     * Registers the controller afresh and redraws every thread on it — for
     * a window whose VS Code has stopped asking GitHawk about comments.
     */
    private reregister(): void {
        log.warn('comments: VS Code is not asking GitHawk for commenting ranges; registering again');
        this.drawnThreads.forEach(({ thread }) => thread.dispose());
        this.drawnThreads.clear();
        this.threads = [];
        this.controller.dispose();
        this.controller = this.createController();
        this.answered.clear();
        this.drawn = '';
        this.draw();
        this.offerRanges();
    }

    dispose(): void {
        this.controller.dispose();
        this.drawnThreads.forEach(({ thread }) => thread.dispose());
        this.disposables.forEach((disposable) => disposable.dispose());
    }

    /** The submit button on a new thread, and Reply on an existing one. */
    async save(reply: vscode.CommentReply): Promise<string | undefined> {
        const { thread, text } = reply;
        const located = this.reviews.locate(thread.uri);
        const range = thread.range;
        if (!located || !range || text.trim().length === 0) {
            return undefined;
        }
        const document = await vscode.workspace.openTextDocument(thread.uri);
        const excerpt = Array.from(
            { length: range.end.line - range.start.line + 1 },
            (_, offset) => document.lineAt(Math.min(range.start.line + offset, document.lineCount - 1)).text
        ).join('\n');

        const { file, side } = located;
        const documentPath =
            side === 'old' ? (file.change.previousPath ?? file.change.path) : file.change.path;
        const comment: ReviewComment = {
            id: randomUUID(),
            path: file.change.path,
            documentPath: documentPath === file.change.path ? undefined : documentPath,
            side,
            rev: side === 'new' ? file.targetRev : file.baseRev,
            line: range.start.line + 1,
            endLine: range.end.line + 1,
            body: text,
            excerpt,
            createdAt: new Date().toISOString(),
        };

        // Saving redraws every thread from the review, this one included;
        // the thread VS Code opened for the typing is then a duplicate.
        await this.reviews.update((review) => addComment(review, comment));
        if (!this.threads.includes(thread)) {
            thread.dispose();
        }
        return comment.id;
    }

    /**
     * Makes room for a new comment on a change that may have some already.
     *
     * Its threads are unfolded, so what was said before is beside what is
     * about to be written. Then the cursor goes to a line of the change with
     * no thread on it: VS Code's Add Comment on a thread's own line folds
     * that thread away rather than opening a box, which would make the
     * Comment button hide the comments it was pressed beside.
     *
     * Returns false when every line of the change already carries a thread;
     * the last one is then opened, its reply box a click away.
     */
    async prepareChange(editor: vscode.TextEditor, range: { start: number; end: number }): Promise<boolean> {
        const uri = editor.document.uri.toString();
        const here = this.threads.filter(
            (thread) =>
                thread.uri.toString() === uri &&
                thread.range !== undefined &&
                thread.range.start.line + 1 <= range.end &&
                range.start <= thread.range.end.line + 1
        );
        here.forEach((thread) => {
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        });
        // VS Code places a thread on its last line; those lines are taken.
        const taken = new Set(here.map((thread) => thread.range!.end.line + 1));
        const cursor = editor.selection.active.line + 1;
        const free = [cursor, ...Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i)]
            .find((line) => line >= range.start && line <= range.end && !taken.has(line));
        if (free !== undefined) {
            const at = new vscode.Position(free - 1, 0);
            editor.selection = new vscode.Selection(at, at);
            return true;
        }
        const last = here[here.length - 1];
        const above = new vscode.Position(Math.max(last.range!.start.line - 1, 0), 0);
        editor.selection = new vscode.Selection(above, above);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await vscode.commands.executeCommand('editor.action.nextCommentThreadAction');
        return false;
    }

    /**
     * Asks for the comment in VS Code's input box, then pins it to the whole
     * change. The fallback for a window where VS Code's own comment box
     * cannot open — it has not asked GitHawk which lines take comments, so
     * Add Comment would only refuse.
     */
    async askForComment(
        editor: vscode.TextEditor,
        at: { path: string; line: number; range: { start: number; end: number }; summary: string }
    ): Promise<string | undefined> {
        const { start, end } = at.range;
        const where = start === end ? `line ${start}` : `lines ${start}–${end}`;
        const text = await vscode.window.showInputBox({
            title: `Comment on ${at.path}, ${where}`,
            prompt: at.summary,
            placeHolder: 'What should change here? Enter saves it; it stays on this machine until you send the review.',
            ignoreFocusOut: true,
        });
        if (!text?.trim()) {
            return undefined;
        }
        const thread = this.controller.createCommentThread(
            editor.document.uri,
            new vscode.Range(start - 1, 0, end - 1, 0),
            []
        );
        return this.save({ thread, text });
    }

    /**
     * See gitHawk.review.commentForTesting: a thread opened on the lines and
     * submitted, through the same save the thread widget's button calls.
     */
    async commentForTesting(uri: vscode.Uri, line: number, endLine: number, text: string) {
        const thread = this.controller.createCommentThread(
            uri,
            new vscode.Range(line - 1, 0, endLine - 1, 0),
            []
        );
        return this.save({ thread, text });
    }

    async remove(comment: ShownComment): Promise<void> {
        await this.reviews.update((review) => removeComment(review, comment.reviewId));
    }

    /** The whole thread: every comment on these lines. */
    async removeThread(thread: vscode.CommentThread): Promise<void> {
        const ids = thread.comments
            .filter((comment): comment is ShownComment => comment instanceof ShownComment)
            .map((comment) => comment.reviewId);
        if (ids.length === 0) {
            // A thread opened and abandoned before anything was typed.
            thread.dispose();
            return;
        }
        await this.reviews.update((review) =>
            ids.reduce((state, id) => removeComment(state, id), review)
        );
    }

    edit(comment: ShownComment): void {
        comment.startEditing();
        this.refresh(comment.thread);
    }

    cancelEdit(comment: ShownComment): void {
        comment.cancelEditing();
        this.refresh(comment.thread);
    }

    async saveEdit(comment: ShownComment): Promise<void> {
        comment.mode = vscode.CommentMode.Preview;
        this.refresh(comment.thread);
        await this.reviews.update((review) => editComment(review, comment.reviewId, comment.text));
    }

    private refresh(thread: vscode.CommentThread): void {
        // Reassigning is what makes VS Code redraw a thread's comments.
        thread.comments = [...thread.comments];
    }

    /**
     * VS Code asks for a document's commenting ranges when it opens and
     * caches the answer. A diff opened before the review started — or before
     * its hunks were read, or before a save moved them — was told "none", and
     * kept that answer, so the + never appeared and Add Comment refused.
     * Handing it a provider again is the API's one way to make it ask again.
     */
    offerRanges(): void {
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document) => this.commentingRanges(document),
        };
    }

    /**
     * Every hunk's lines on the side the document is, so the + appears on
     * the change and nowhere else — a review comments on what changed.
     */
    private commentingRanges(document: vscode.TextDocument): vscode.Range[] {
        const ranges = this.rangesFor(document);
        // Said in the log whenever the answer changes: when Add Comment
        // refuses, this is what tells whether VS Code asked, and what it heard.
        const answer = ranges.map((range) => `${range.start.line + 1}–${range.end.line + 1}`).join(', ') || 'none';
        const key = document.uri.toString();
        if (this.answered.get(key) !== answer) {
            this.answered.set(key, answer);
            log.info(`commenting ranges for ${key}: ${answer}`);
        }
        return ranges;
    }

    private readonly answered = new Map<string, string>();

    /**
     * Whether VS Code will accept Add Comment on this document: it has asked
     * for the lines that can take one, and been given some. Waits a moment
     * for the asking when it has not happened yet — a diff opened just now,
     * or one opened before its hunks were read.
     */
    async readyForComments(uri: vscode.Uri, waitMs = 1500): Promise<boolean> {
        const ready = () => {
            const answer = this.answered.get(uri.toString());
            return answer !== undefined && answer !== 'none';
        };
        if (ready()) {
            return true;
        }
        const wait = async () => {
            for (let waited = 0; waited < waitMs && !ready(); waited += 50) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        };
        this.offerRanges();
        await wait();
        if (!ready() && !this.answered.has(uri.toString())) {
            // Not asked at all — not even answered "none" — is VS Code
            // having lost the controller, not a document still loading.
            this.reregister();
            await wait();
        }
        return ready();
    }

    private rangesFor(document: vscode.TextDocument): vscode.Range[] {
        const located = this.reviews.locate(document.uri);
        if (!located) {
            return [];
        }
        return (this.reviews.hunksOf(located.file) ?? []).map((hunk) => {
            const { start, end } =
                located.side === 'new' ? hunkNewRange(hunk) : hunkOldRange(hunk);
            const last = Math.min(end, document.lineCount) - 1;
            return new vscode.Range(start - 1, 0, Math.max(last, start - 1), 0);
        });
    }

    /**
     * Rebuilds the threads from the review, when the comments in it are not
     * the ones on screen: after a reload, a switch of repository, a handoff
     * that marked them sent, or the end of the review.
     */
    private draw(): void {
        const review = this.reviews.current;
        const root = this.repositoryRoot();
        const signature = review && root
            ? JSON.stringify([root, review.comments.map((c) => [c.id, c.sentAt, c.body])])
            : '';
        if (signature === this.drawn) {
            return;
        }
        this.drawn = signature;

        if (!review || !root) {
            this.drawnThreads.forEach(({ thread }) => thread.dispose());
            this.drawnThreads.clear();
            this.threads = [];
            return;
        }

        const groups = new Map<string, ReviewComment[]>();
        for (const comment of review.comments) {
            const key = `${root}\0${comment.side}\0${comment.rev ?? ''}\0${comment.documentPath ?? comment.path}\0${comment.line}\0${comment.endLine}`;
            groups.set(key, [...(groups.get(key) ?? []), comment]);
        }

        /*
         * Changed in place, not torn down and rebuilt: a thread disposed and
         * recreated at the same lines vanished from the Comments panel, and
         * lost whether the reader had it open or folded.
         */
        for (const [key, drawn] of this.drawnThreads) {
            if (!groups.has(key)) {
                drawn.thread.dispose();
                this.drawnThreads.delete(key);
            }
        }
        for (const [key, comments] of groups) {
            const signature = JSON.stringify(comments.map((c) => [c.id, c.sentAt, c.body]));
            const drawn = this.drawnThreads.get(key);
            if (drawn) {
                if (drawn.signature !== signature) {
                    drawn.thread.comments = comments.map(
                        (comment) => new ShownComment(comment.id, comment.body, comment.sentAt, drawn.thread)
                    );
                    drawn.signature = signature;
                }
                continue;
            }
            const first = comments[0];
            const path = first.documentPath ?? first.path;
            const uri =
                first.rev === undefined
                    ? vscode.Uri.file(join(root, path))
                    : encodeRevisionUri(first.rev, path);
            const thread = this.controller.createCommentThread(
                uri,
                new vscode.Range(first.line - 1, 0, first.endLine - 1, 0),
                []
            );
            thread.comments = comments.map(
                (comment) => new ShownComment(comment.id, comment.body, comment.sentAt, thread)
            );
            this.decorateThread(thread, first);
            this.drawnThreads.set(key, { thread, signature });
        }
        this.threads = [...this.drawnThreads.values()].map(({ thread }) => thread);
    }

    /** Threads on screen, by the lines they are on, with what they were drawn from. */
    private readonly drawnThreads = new Map<string, { thread: vscode.CommentThread; signature: string }>();

    private decorateThread(thread: vscode.CommentThread, comment: ReviewComment): void {
        thread.label = `${comment.path}:${comment.line}`;
        thread.canReply = true;
        thread.contextValue = 'gitHawkReviewThread';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
}

export type { ShownComment };
