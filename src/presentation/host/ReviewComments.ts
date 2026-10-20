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
    private readonly controller = vscode.comments.createCommentController(
        REVIEW_COMMENT_CONTROLLER_ID,
        'GitHawk Review'
    );
    private threads: vscode.CommentThread[] = [];
    private readonly disposables: vscode.Disposable[] = [this.controller];
    /** What the threads on screen were drawn from, so a redraw happens only when it changed. */
    private drawn = '';

    constructor(
        private readonly reviews: ReviewController,
        private readonly repositoryRoot: () => string | undefined
    ) {
        this.controller.options = {
            prompt: 'Comment on these lines',
            placeHolder:
                'A note for whoever fixes this — kept on this machine until you send the review to an AI CLI',
        };
        this.controller.commentingRangeProvider = {
            provideCommentingRanges: (document) => this.commentingRanges(document),
        };
        this.disposables.push(reviews.onDidChange(() => this.draw()));
    }

    dispose(): void {
        this.threads.forEach((thread) => thread.dispose());
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
     * Every hunk's lines on the side the document is, so the + appears on
     * the change and nowhere else — a review comments on what changed.
     */
    private commentingRanges(document: vscode.TextDocument): vscode.Range[] {
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

        this.threads.forEach((thread) => thread.dispose());
        this.threads = [];
        if (!review || !root) {
            return;
        }

        const groups = new Map<string, ReviewComment[]>();
        for (const comment of review.comments) {
            const key = `${comment.side}\0${comment.rev ?? ''}\0${comment.documentPath ?? comment.path}\0${comment.line}\0${comment.endLine}`;
            groups.set(key, [...(groups.get(key) ?? []), comment]);
        }

        for (const comments of groups.values()) {
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
            this.threads.push(thread);
        }
    }

    private decorateThread(thread: vscode.CommentThread, comment: ReviewComment): void {
        thread.label = `${comment.path}:${comment.line}`;
        thread.canReply = true;
        thread.contextValue = 'gitHawkReviewThread';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
}

export type { ShownComment };
