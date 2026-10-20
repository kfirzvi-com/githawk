import * as vscode from 'vscode';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hunkNewRange, hunkOldRange } from '../../domain/models/Hunk';
import {
    addComment,
    addReply,
    editComment,
    removeComment,
    removeReply,
    resolve,
    type AgentStatus,
    type ReviewComment,
    type ReviewReply,
} from '../../domain/models/Review';
import type { ReviewController } from './ReviewController';
import { encodeRevisionUri } from './RevisionContentProvider';
import { log } from './log';

/**
 * The start of every review comment controller's id; package.json's menus
 * match on it. The rest is unique per registration — see createController.
 */
export const REVIEW_COMMENT_CONTROLLER_ID = 'gitHawk.review';

/** Who is writing: the repository's git user, with an avatar of their initials. */
export interface CommentAuthor {
    name: string;
    iconPath?: vscode.Uri;
}

let author: CommentAuthor = { name: 'You' };

/**
 * The author every comment is shown with. Set once the git user is known;
 * until then, and for a repository with no user configured, "You".
 */
export function setCommentAuthor(name: string | undefined): void {
    const shown = name?.trim() || 'You';
    author = { name: shown, iconPath: avatarFor(shown) };
}

/**
 * A round avatar of the author's initials, in GitHawk's blue, as an SVG
 * data URI — the comment header's picture, without a network fetch or a
 * file to ship.
 */
function avatarFor(name: string, colour = '#4EA3E8'): vscode.Uri {
    const initials =
        name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('') || '?';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${colour}"/><text x="32" y="41" text-anchor="middle" font-family="-apple-system, Segoe UI, sans-serif" font-size="26" font-weight="600" fill="#ffffff">${initials.replace(/[<>&]/g, '')}</text></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

/** The agent, in its replies: its tool's name, and an avatar of another colour. */
function agentAuthor(name: string | undefined): CommentAuthor {
    const shown = name?.replace(/ — review$/, '') || 'Agent';
    return { name: shown, iconPath: avatarFor(shown, '#A371F7') };
}

const STATUS_LABEL: Record<AgentStatus, string> = {
    done: '✓ done',
    question: '? question',
    wontfix: "✗ won't fix",
};

/** A comment on screen, knowing which comment of the review it shows. */
class ShownComment implements vscode.Comment {
    mode = vscode.CommentMode.Preview;
    author = author;
    contextValue = 'gitHawkReviewComment';
    body: vscode.MarkdownString;
    label?: string;
    timestamp?: Date;
    /** What the body was before an edit began, for Cancel. */
    private saved: string;

    constructor(
        readonly reviewId: string,
        text: string,
        shown: { createdAt?: string; sentAt?: string; sentTo?: string },
        readonly thread: vscode.CommentThread
    ) {
        this.body = new vscode.MarkdownString(text);
        this.saved = text;
        // Nothing said while it is only a note; once handed over, to whom.
        this.label = shown.sentAt
            ? `sent${shown.sentTo ? ` · ${shown.sentTo.replace(/ — review$/, '')}` : ''}`
            : undefined;
        this.timestamp = shown.createdAt ? new Date(shown.createdAt) : undefined;
    }

    /**
     * A comment not written yet: blank, and already being edited, alone in
     * a thread of its own. VS Code puts the keyboard in such a comment the
     * moment its thread opens, and closing it is GitHawk's to do — see
     * ReviewComments.openDraft.
     */
    static draft(thread: vscode.CommentThread): ShownComment {
        const draft = new ShownComment('', '', {}, thread);
        draft.mode = vscode.CommentMode.Editing;
        draft.contextValue = 'gitHawkReviewDraft';
        draft.label = '⌘↵ saves · Esc cancels'.replace('⌘', process.platform === 'darwin' ? '⌘' : 'Ctrl+');
        return draft;
    }

    get isDraft(): boolean {
        return this.reviewId === '';
    }

    /** The id of the reply this shows, when it is one rather than the comment. */
    replyId?: string;

    /** One message of the conversation under a comment. */
    static reply(commentId: string, reply: ReviewReply, thread: vscode.CommentThread): ShownComment {
        const shown = new ShownComment(commentId, reply.body, { createdAt: reply.createdAt }, thread);
        shown.replyId = reply.id;
        if (reply.from === 'agent') {
            shown.author = agentAuthor(reply.author);
            shown.label = reply.status ? STATUS_LABEL[reply.status] : undefined;
            shown.contextValue = 'gitHawkAgentReply';
        } else {
            shown.label = reply.sentAt ? 'sent' : undefined;
            shown.contextValue = 'gitHawkReviewReply';
        }
        return shown;
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
            prompt: 'Reply',
            placeHolder: 'Reply… it goes to the agent with the next handoff',
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
        // The reply box under a conversation: an answer in it, not a new comment.
        const root = this.rootOf(thread);
        if (root && text.trim()) {
            const id = randomUUID();
            await this.reviews.update((review) => addReply(review, root, { id, body: text, now: new Date() }));
            return id;
        }
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
     * Opens a new comment on the cursor's line, ready to type into.
     *
     * Not VS Code's Add Comment: the box it opens is VS Code's own, and in
     * this VS Code Escape does not close it. This is a thread of GitHawk's
     * holding one blank comment already being edited; VS Code focuses such a
     * comment when its thread opens, so the keyboard is in it at once, and
     * Escape closes it because GitHawk can.
     */
    async openDraft(editor: vscode.TextEditor): Promise<void> {
        this.discardDrafts();
        const line = editor.selection.active.line;
        // In view first: VS Code will not focus a comment it has not drawn,
        // and the keystrokes meant for the box would land in the code.
        editor.revealRange(
            new vscode.Range(line, 0, line, 0),
            vscode.TextEditorRevealType.InCenterIfOutsideViewport
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        const thread = this.controller.createCommentThread(
            editor.document.uri,
            new vscode.Range(line, 0, line, 0),
            []
        );
        thread.canReply = false;
        thread.label = `New comment · line ${line + 1}`;
        thread.contextValue = 'gitHawkReviewDraft';
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        thread.comments = [ShownComment.draft(thread)];
        this.drafts = [thread];
        // Collapsed then expanded: the opening is what VS Code focuses on,
        // and it has to have drawn the folded thread first to see one.
        await new Promise((resolve) => setTimeout(resolve, 300));
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }

    /** Add Review Comment on a draft. */
    async saveDraft(comment: ShownComment): Promise<string | undefined> {
        const thread = comment.thread;
        const text = comment.text;
        this.drafts = this.drafts.filter((draft) => draft !== thread);
        if (!text.trim()) {
            thread.dispose();
            return undefined;
        }
        return this.save({ thread, text });
    }

    /**
     * Escape in a review comment: a draft goes, an edit is abandoned, and an
     * open thread folds away — then the keyboard is back in the code.
     */
    async escape(): Promise<void> {
        if (this.drafts.length > 0) {
            this.discardDrafts();
        } else {
            let cancelled = false;
            for (const thread of this.threads) {
                for (const comment of thread.comments) {
                    if (comment instanceof ShownComment && comment.mode === vscode.CommentMode.Editing) {
                        comment.cancelEditing();
                        this.refresh(thread);
                        cancelled = true;
                    }
                }
            }
            if (!cancelled) {
                const uri = vscode.window.activeTextEditor?.document.uri.toString();
                for (const thread of this.threads) {
                    if (thread.uri.toString() === uri) {
                        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
                    }
                }
            }
        }
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    }

    /** Unfolds the thread a comment is in — the end of a step to it. */
    expandThreadOf(commentId: string): void {
        for (const thread of this.threads) {
            if (thread.comments.some((comment) => comment instanceof ShownComment && comment.reviewId === commentId)) {
                thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
            }
        }
    }

    private discardDrafts(): void {
        this.drafts.forEach((draft) => draft.dispose());
        this.drafts = [];
    }

    private drafts: vscode.CommentThread[] = [];

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

    /** See gitHawk.review.threadForTesting: the thread a comment is in, through the real buttons. */
    async threadActionForTesting(commentId: string, action: 'reply' | 'resolve' | 'reopen', text = '') {
        const thread = this.threads.find((candidate) => this.rootsOf(candidate).includes(commentId));
        if (!thread) {
            throw new Error(`no thread on screen holds ${commentId}`);
        }
        if (action === 'reply') {
            return this.save({ thread, text });
        }
        await this.setResolved(thread, action === 'resolve');
        return { collapsed: thread.collapsibleState === vscode.CommentThreadCollapsibleState.Collapsed, canReply: thread.canReply };
    }

    async remove(comment: ShownComment): Promise<void> {
        const { replyId } = comment;
        await this.reviews.update((review) =>
            replyId ? removeReply(review, comment.reviewId, replyId) : removeComment(review, comment.reviewId)
        );
    }

    /** Resolve or Reopen, from a thread's title: every comment in it. */
    async setResolved(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
        const roots = this.rootsOf(thread);
        if (roots.length === 0) {
            return;
        }
        await this.reviews.update((review) =>
            roots.reduce((state, id) => resolve(state, id, resolved, new Date()), review)
        );
    }

    /** The review comments a thread on screen shows, by id. */
    private rootsOf(thread: vscode.CommentThread): string[] {
        return [
            ...new Set(
                thread.comments
                    .filter((comment): comment is ShownComment => comment instanceof ShownComment && !comment.isDraft)
                    .map((comment) => comment.reviewId)
            ),
        ];
    }

    /** The comment a reply typed into this thread answers: its latest. */
    private rootOf(thread: vscode.CommentThread): string | undefined {
        if (![...this.drawnThreads.values()].some((drawn) => drawn.thread === thread)) {
            return undefined;
        }
        return this.rootsOf(thread).pop();
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
        if (comment.isDraft) {
            this.drafts = this.drafts.filter((draft) => draft !== comment.thread);
            comment.thread.dispose();
            return;
        }
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
            ? JSON.stringify([root, review.comments, author.name])
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
            const signature = JSON.stringify(
                comments.map((c) => [c.id, c.sentAt, c.sentTo, c.body, c.resolvedAt, c.replies, author.name])
            );
            const drawn = this.drawnThreads.get(key);
            // VS Code adds a second reply box, rather than showing the one,
            // when a thread that could not be replied to becomes one that can:
            // such a thread is drawn afresh instead of changed.
            const repliable = !comments.every((c) => c.resolvedAt) && comments.some((c) => (c.replies ?? []).length > 0);
            if (drawn && drawn.thread.canReply !== repliable) {
                drawn.thread.dispose();
                this.drawnThreads.delete(key);
            } else if (drawn) {
                if (drawn.signature !== signature) {
                    const before = JSON.parse(drawn.signature) as unknown[][];
                    const agentRepliesBefore = before.reduce(
                        (sum, row) => sum + ((row[5] as ReviewReply[] | null) ?? []).filter((r) => r.from === 'agent').length,
                        0
                    );
                    const resolvedBefore = before.every((row) => row[4]);
                    drawn.thread.comments = this.shownComments(comments, drawn.thread);
                    this.decorateConversation(drawn.thread, comments, {
                        resolvedChanged: resolvedBefore !== comments.every((c) => c.resolvedAt),
                        agentAnswered:
                            comments.reduce((sum, c) => sum + (c.replies ?? []).filter((r) => r.from === 'agent').length, 0) >
                            agentRepliesBefore,
                    });
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
            thread.comments = this.shownComments(comments, thread);
            this.decorateThread(thread, first);
            this.decorateConversation(thread, comments, {
                resolvedChanged: true,
                agentAnswered: comments.some((c) => (c.replies ?? []).some((r) => r.from === 'agent')),
            });
            this.drawnThreads.set(key, { thread, signature });
        }
        this.threads = [...this.drawnThreads.values()].map(({ thread }) => thread);
    }

    /** Threads on screen, by the lines they are on, with what they were drawn from. */
    private readonly drawnThreads = new Map<string, { thread: vscode.CommentThread; signature: string }>();

    /** A thread's comments with their conversations, in order. */
    private shownComments(comments: ReviewComment[], thread: vscode.CommentThread): ShownComment[] {
        return comments.flatMap((comment) => [
            new ShownComment(comment.id, comment.body, comment, thread),
            ...(comment.replies ?? []).map((reply) => ShownComment.reply(comment.id, reply, thread)),
        ]);
    }

    /**
     * What a conversation changes about its thread: a reply box once the
     * agent has answered — there is something to answer back — Resolve or
     * Reopen in its title, and folded when resolved. An answer from the
     * agent opens the thread, so it is seen.
     */
    private decorateConversation(
        thread: vscode.CommentThread,
        comments: ReviewComment[],
        changes: { resolvedChanged: boolean; agentAnswered: boolean }
    ): void {
        const resolved = comments.every((comment) => comment.resolvedAt);
        thread.canReply = !resolved && comments.some((comment) => (comment.replies ?? []).length > 0);
        thread.state = resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
        thread.contextValue = resolved ? 'gitHawkThreadResolved' : 'gitHawkThreadOpen';
        if (changes.resolvedChanged) {
            thread.collapsibleState = resolved
                ? vscode.CommentThreadCollapsibleState.Collapsed
                : vscode.CommentThreadCollapsibleState.Expanded;
        }
        if (changes.agentAnswered && !resolved) {
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        }
    }

    private decorateThread(thread: vscode.CommentThread, comment: ReviewComment): void {
        // The file is the editor's tab already; the lines are what tells
        // one thread from the next.
        thread.label =
            comment.line === comment.endLine
                ? `Line ${comment.line}`
                : `Lines ${comment.line}–${comment.endLine}`;
        // No reply box under every thread: Comment on the change adds
        // another, and a box per thread is most of what the screen showed.
        thread.canReply = false;
    }
}

export type { ShownComment };
