import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ComparisonDto } from '../../application/dto/ComparisonDto';
import type { ComparisonSpec } from '../../domain/models/Comparison';
import {
    hunkDeletions,
    hunkFocusLine,
    hunkId,
    hunkInsertions,
    hunkNewRange,
    hunkOldRange,
    type Hunk,
} from '../../domain/models/Hunk';
import {
    fileState,
    isHunkViewed,
    markFile,
    markHunk,
    pinSpec,
    reviewProgress,
    sameSpec,
    startReview,
    wholeFileHunkId,
    applyAgentReplies,
    type AgentReply,
    type Review,
    type ReviewComment,
    type ReviewedFile,
} from '../../domain/models/Review';
import type { IHunkReader } from '../../domain/repositories/IHunkReader';
import type { ChangedFilesTree, ReviewOverlay } from './ChangedFilesTree';
import type { FileNode, TreeNode } from './changedFilesTreeModel';
import type { OpenFileRequest } from './ComparisonController';
import { REVISION_SCHEME, decodeRevisionUri } from './RevisionContentProvider';
import { log } from './log';

/** Workspace state: every repository's reviews in progress, by root. */
const STORE_KEY = 'gitHawk.reviews';

/** Set while the Changes view is showing a changeset under review. */
export const REVIEWING_CONTEXT = 'gitHawk.reviewing';
/** Set while any review is in progress, which is when the Reviews view is worth its room. */
export const HAS_REVIEWS_CONTEXT = 'gitHawk.hasReviews';

/** A review as the Reviews view lists it: which repository, and whether it is on screen. */
export interface ReviewEntry {
    root: string;
    review: Review;
    onScreen: boolean;
}

/**
 * Enough to read a large changeset quickly without starting a hundred git
 * processes at once.
 */
const HUNK_READS_AT_ONCE = 8;

/** Where a document is in the review: which row, and which side of its diff. */
export interface Located {
    file: FileNode;
    side: 'new' | 'old';
}

/** One stop on the way through a review: a hunk, or a file that has none. */
interface Stop {
    file: FileNode;
    hunk?: Hunk;
}

export interface ReviewControllerDeps {
    store: vscode.Memento;
    tree: ChangedFilesTree;
    hunkReader: () => IHunkReader;
    resolveRevision: (rev: string) => Promise<string>;
    repositoryRoot: () => string | undefined;
    /**
     * A file on disk as a path within the repository, or undefined when it is
     * outside it. Symlinks resolved: on a Mac the workspace says /tmp and git
     * says /private/tmp, and the two must still be one file.
     */
    relativePath: (fsPath: string) => string | undefined;
    showComparison: (spec: ComparisonSpec) => Promise<void>;
    /** A commit's subject line, so a review of it is named by more than a hash. */
    commitSubject: (rev: string) => Promise<string | undefined>;
    /** Points GitHawk at another repository, for a review that belongs to it. */
    switchRepository: (root: string) => Promise<void>;
    showWorkingTree: () => Promise<void>;
    openFile: (request: OpenFileRequest) => Promise<void>;
}

/**
 * Review mode for the Changes view.
 *
 * Keeps every review in progress, several per repository — a pull request's
 * commits, a colleague's branch, your own uncommitted work — and shows
 * whichever one matches what the Changes view is showing. For that one it
 * keeps three things in step: the tree's checkboxes and hunk rows, the
 * buttons and markers in the diff editor, and the review's copy in workspace
 * state, which is what lets a review be left for another, or for a window
 * reload, and picked up where it stopped.
 *
 * Everything that decides what "viewed" means is in the domain's Review; this
 * class only asks it and draws the answer.
 */
export class ReviewController
    implements vscode.Disposable, ReviewOverlay, vscode.CodeLensProvider
{
    /** The review whose changeset the Changes view is showing, if any. */
    private review?: Review;
    /** True while the tree is showing the review's own changeset. */
    private active = false;
    private hunks = new Map<string, Hunk[]>();
    private loadTicket = 0;
    private loading: Promise<void> = Promise.resolve();
    /** The last stop visited, for when the editor cannot say where the reader is. */
    private lastStop?: { path: string; hunkId?: string };
    private readonly changed = new vscode.EventEmitter<void>();
    /** Fires whenever the review, its marks, or what is on screen changes. */
    readonly onDidChange = this.changed.event;
    private readonly disposables: vscode.Disposable[] = [];

    /*
     * The buttons on each change are a CodeLens, above; these only mark the
     * scrollbar, so what is left to read can be seen at a glance down the
     * whole file.
     */
    private readonly viewedMarker = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    private readonly unviewedMarker = vscode.window.createTextEditorDecorationType({
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    /** Tells VS Code to ask for the CodeLenses again. */
    readonly onDidChangeCodeLenses = this.changed.event;

    constructor(private readonly deps: ReviewControllerDeps) {
        this.disposables.push(
            this.viewedMarker,
            this.unviewedMarker,
            this.changed,
            deps.tree.onDidShow((comparison) => this.shown(comparison)),
            vscode.window.onDidChangeVisibleTextEditors(() => this.decorate())
        );
        void this.setContexts();
    }

    dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
    }

    get current(): Review | undefined {
        return this.review;
    }

    get isActive(): boolean {
        return this.active;
    }

    /** Resolves once the hunks of what is on screen have been read. */
    whenLoaded(): Promise<void> {
        return this.loading;
    }

    // ---- ReviewOverlay: what the tree asks -------------------------------

    hunksOf(file: FileNode): readonly Hunk[] | undefined {
        return this.hunks.get(fileKey(file));
    }

    fileState(file: FileNode) {
        const reviewed = this.reviewedFile(file);
        return this.review && reviewed ? fileState(this.review, reviewed) : 'unviewed';
    }

    isViewed(file: FileNode, hunk: Hunk): boolean {
        return this.review ? isHunkViewed(this.review, file.change.path, hunk.id) : false;
    }

    progress(): { text: string; unviewed: number } {
        if (!this.review) {
            return { text: '', unviewed: 0 };
        }
        const files = this.deps.tree.files
            .map((file) => this.reviewedFile(file))
            .filter((file): file is ReviewedFile => file !== undefined);
        const progress = reviewProgress(this.review, files);
        const comments = this.review.comments.length;
        return {
            text: [
                `${progress.filesViewed}/${progress.files} files`,
                `${progress.hunksViewed}/${progress.hunks} changes viewed`,
                comments > 0 ? `${comments} ${comments === 1 ? 'comment' : 'comments'}` : '',
            ]
                .filter(Boolean)
                .join('  ·  '),
            unviewed: progress.hunks - progress.hunksViewed,
        };
    }

    message(): string {
        return [
            `Reviewing ${this.review?.label ?? ''}. Kept until you end it.`,
            `${keys(']')} next   ${keys('⇧V')} viewed   ${keys('⇧C')} comment   ${keys('⇧]')} next comment   ${keys('⇧S')} send to AI`,
        ].join('\n');
    }

    // ---- CodeLens: the buttons on each change ------------------------------

    /**
     * Comment and Mark viewed, on the line above each change — the button is
     * where the change is, not in a tree or a title bar the reader has to
     * connect to it. The diff editor hides CodeLenses unless
     * `diffEditor.codeLens` is on, which package.json makes the default.
     */
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const located = this.locate(document.uri);
        if (!located || (located.side === 'old' && located.file.change.status !== 'deleted')) {
            return [];
        }
        const { file } = located;
        return (this.hunksOf(file) ?? []).flatMap((hunk) => {
            const line = Math.min(
                Math.max(
                    (located.side === 'new' ? hunkNewRange(hunk) : hunkOldRange(hunk)).start - 1,
                    0
                ),
                Math.max(document.lineCount - 1, 0)
            );
            const range = new vscode.Range(line, 0, line, 0);
            const args = [file.change.path, file.group ?? null, hunk.id];
            const viewed = this.isViewed(file, hunk);
            return [
                new vscode.CodeLens(range, {
                    title: '$(comment) Comment',
                    tooltip: `Comment on this change (${keys('⇧C')})`,
                    command: 'gitHawk.review.commentOnHunk',
                    arguments: args,
                }),
                new vscode.CodeLens(range, {
                    title: viewed ? '$(pass-filled) Viewed' : '$(circle-large-outline) Mark viewed',
                    tooltip: viewed
                        ? 'Viewed. Click to read it again'
                        : `Mark this change viewed (${keys('⇧V')})`,
                    command: 'gitHawk.review.toggleHunk',
                    arguments: args,
                }),
            ];
        });
    }

    // ---- Every review in progress ------------------------------------------

    /** Every review, in every repository, most recently started first. */
    entries(): ReviewEntry[] {
        return Object.entries(this.stored())
            .flatMap(([root, reviews]) =>
                reviews.map((review) => ({
                    root,
                    review: review.id === this.review?.id ? this.review : review,
                    onScreen: this.active && review.id === this.review?.id,
                }))
            )
            .sort((a, b) => b.review.startedAt.localeCompare(a.review.startedAt));
    }

    private reviewsOf(root: string): Review[] {
        return this.stored()[root] ?? [];
    }

    private find(id: string): ReviewEntry | undefined {
        return this.entries().find((entry) => entry.review.id === id);
    }

    // ---- Starting, resuming, ending --------------------------------------

    /**
     * Starts reviewing what the Changes view shows — or, with nothing shown,
     * returns to a review in progress, or reviews the uncommitted changes.
     * Pressed again mid-review it goes to the next change not yet viewed,
     * so the one key both opens a review and moves through it.
     *
     * Starting one never ends another: a pull request, a colleague's branch
     * and your own work in progress can all be under review at once, and the
     * Reviews view lists them.
     */
    async start(): Promise<void> {
        const root = this.deps.repositoryRoot();
        if (!root) {
            return;
        }

        if (this.review && this.active) {
            await this.next({ unviewedOnly: true });
            return;
        }

        let comparison = this.deps.tree.current;
        if (!comparison && this.entries().length > 0) {
            await this.resume();
            return;
        }
        if (!comparison) {
            await this.deps.showWorkingTree();
            comparison = this.deps.tree.current;
        }
        if (!comparison) {
            vscode.window.showInformationMessage(
                'Nothing to review yet: select a commit in the graph, compare two branches, or change a file.'
            );
            return;
        }

        const spec = pinSpec(comparison.spec, {
            baseRev: await this.resolve(comparison.baseRev),
            targetRev:
                comparison.targetRev === undefined
                    ? undefined
                    : await this.resolve(comparison.targetRev),
        });
        // Pinned, the comparison may turn out to be one already under review.
        const existing = this.reviewsOf(root).find((review) => sameSpec(review.spec, spec));
        this.review =
            existing ??
            startReview({
                id: randomUUID(),
                root,
                label: await this.labelFor(comparison),
                spec,
                now: new Date(),
            });
        this.lastStop = undefined;
        await this.save();
        log.info(`review started: ${comparison.label} ${JSON.stringify(spec)}`);

        if (sameSpec(spec, comparison.spec)) {
            this.shown(comparison);
        } else {
            // Pinned to hashes, which is a different spec from the names the
            // comparison was asked for by; asking again under the pinned one
            // is what makes the tree recognisably the review's.
            await this.deps.showComparison(spec);
        }
        await this.whenLoaded();
        await vscode.commands.executeCommand('gitHawkChanges.focus');
        await this.next({ unviewedOnly: true, quiet: true });
    }

    /**
     * Puts a review's changeset back in the Changes view — the one named, or
     * the only one, or whichever the reader picks. A review of another
     * repository switches to that repository first.
     */
    async resume(id?: string): Promise<void> {
        const entry = id ? this.find(id) : await this.pick('Resume which review?');
        if (!entry) {
            return;
        }
        if (entry.root !== this.deps.repositoryRoot()) {
            await this.deps.switchRepository(entry.root);
        }
        await this.deps.showComparison(entry.review.spec);
        await this.whenLoaded();
        await vscode.commands.executeCommand('gitHawkChanges.focus');
    }

    private async pick(title: string): Promise<ReviewEntry | undefined> {
        const entries = this.entries();
        if (entries.length <= 1) {
            return entries[0];
        }
        const chosen = await vscode.window.showQuickPick(
            entries.map((entry) => ({
                label: `$(checklist) ${entry.review.label}`,
                description: describeProgress(entry.review),
                detail: entry.root,
                entry,
            })),
            { title }
        );
        return chosen?.entry;
    }

    /**
     * Ends a review — the one on screen, or the one named — and forgets it.
     * Says what goes with it first: viewed marks and unsent comments are
     * work, and neither is anywhere else.
     */
    async end(options: { confirmed?: boolean; id?: string } = {}): Promise<boolean> {
        const entry = options.id
            ? this.find(options.id)
            : this.review
              ? { root: this.review.root, review: this.review, onScreen: this.active }
              : await this.pick('End which review?');
        if (!entry) {
            return false;
        }
        const { review } = entry;
        const loss = this.describeLoss(review);
        if (!options.confirmed && loss !== 'nothing yet') {
            const choice = await vscode.window.showWarningMessage(
                `End the review of “${review.label}”?`,
                { modal: true, detail: `This discards ${loss}.` },
                'End Review'
            );
            if (choice !== 'End Review') {
                return false;
            }
        }
        await this.store(review.root, (reviews) =>
            reviews.filter((candidate) => candidate.id !== review.id)
        );
        if (this.review?.id === review.id) {
            this.review = undefined;
            this.active = false;
            this.hunks.clear();
            this.deps.tree.setReview(undefined);
        }
        this.noteOthers();
        this.decorate();
        await this.setContexts();
        this.changed.fire();
        return true;
    }

    private describeLoss(review: Review): string {
        const viewed = Object.values(review.viewed).reduce((sum, ids) => sum + ids.length, 0);
        const comments = review.comments.length;
        const parts = [
            viewed > 0 ? `${viewed} viewed ${viewed === 1 ? 'change' : 'changes'}` : '',
            comments > 0 ? `${comments} ${comments === 1 ? 'comment' : 'comments'}` : '',
        ].filter(Boolean);
        return parts.length > 0 ? parts.join(' and ') : 'nothing yet';
    }

    // ---- Marking ----------------------------------------------------------

    /** A checkbox ticked or unticked in the tree. */
    async checkboxesChanged(
        items: readonly (readonly [TreeNode, vscode.TreeItemCheckboxState])[]
    ): Promise<void> {
        for (const [node, state] of items) {
            const viewed = state === vscode.TreeItemCheckboxState.Checked;
            if (node.kind === 'hunk') {
                this.mark(node.file, node.hunk, viewed);
            } else if (node.kind === 'file') {
                this.mark(node, undefined, viewed);
            }
        }
        await this.saveAndRedraw();
    }

    /**
     * Toggles the change the reader is on — the hunk under the cursor in a
     * diff, or the row selected in the tree — and, if that marked it viewed,
     * goes straight on to the next one not yet viewed.
     */
    async markCurrent(options: { wholeFile?: boolean } = {}): Promise<void> {
        const stop = this.currentStop();
        if (!this.review || !stop) {
            vscode.window.setStatusBarMessage(
                'GitHawk: open a change from the review first',
                3000
            );
            return;
        }
        const target = options.wholeFile ? { file: stop.file } : stop;
        const nowViewed = !this.isStopViewed(target);
        this.mark(target.file, target.hunk, nowViewed);
        this.lastStop = { path: stop.file.change.path, hunkId: stop.hunk?.id };
        await this.saveAndRedraw();
        if (nowViewed) {
            await this.next({ unviewedOnly: true });
        }
    }

    /**
     * Space in the Changes tree: ticks the selected rows, or unticks them
     * when they are all ticked already. VS Code's trees do not do this for
     * checkboxes by themselves.
     */
    async toggleSelected(rows: readonly TreeNode[]): Promise<void> {
        const targets = rows.filter(
            (row): row is Extract<TreeNode, { kind: 'file' | 'hunk' }> =>
                row.kind === 'file' || row.kind === 'hunk'
        );
        if (targets.length === 0) {
            return;
        }
        const viewed = (row: (typeof targets)[number]) =>
            row.kind === 'hunk'
                ? this.isViewed(row.file, row.hunk)
                : this.fileState(row) === 'viewed';
        const tick = !targets.every(viewed);
        for (const row of targets) {
            if (row.kind === 'hunk') {
                this.mark(row.file, row.hunk, tick);
            } else {
                this.mark(row, undefined, tick);
            }
        }
        await this.saveAndRedraw();
    }

    /** For tests and the palette: mark one file or hunk by path, as the tree does. */
    async markPath(path: string, viewed: boolean, hunkIndex?: number): Promise<void> {
        const file = this.deps.tree.files.find((node) => node.change.path === path);
        if (!file) {
            throw new Error(`${path} is not in the review`);
        }
        const hunk = hunkIndex === undefined ? undefined : this.hunksOf(file)?.[hunkIndex];
        this.mark(file, hunk, viewed);
        await this.saveAndRedraw();
    }

    private mark(file: FileNode, hunk: Hunk | undefined, viewed: boolean): void {
        if (!this.review) {
            return;
        }
        if (hunk) {
            this.review = markHunk(this.review, file.change.path, hunk.id, viewed);
            return;
        }
        const reviewed = this.reviewedFile(file);
        if (reviewed) {
            this.review = markFile(this.review, reviewed, viewed);
        }
    }

    private isStopViewed(stop: Stop): boolean {
        if (!this.review) {
            return false;
        }
        if (stop.hunk) {
            return isHunkViewed(this.review, stop.file.change.path, stop.hunk.id);
        }
        return this.fileState(stop.file) === 'viewed';
    }

    // ---- Moving through it --------------------------------------------------

    /** Opens the next change — or the next one not yet viewed — in the diff editor. */
    async next(options: { unviewedOnly?: boolean; quiet?: boolean } = {}): Promise<boolean> {
        return this.step(1, options);
    }

    async previous(options: { unviewedOnly?: boolean } = {}): Promise<boolean> {
        return this.step(-1, options);
    }

    private async step(
        direction: 1 | -1,
        options: { unviewedOnly?: boolean; quiet?: boolean }
    ): Promise<boolean> {
        if (!this.review || !this.active) {
            if (!options.quiet) {
                vscode.window.setStatusBarMessage('GitHawk: no review is on screen', 3000);
            }
            return false;
        }
        const stops = this.stops();
        if (stops.length === 0) {
            return false;
        }

        const here = this.position(stops);
        // Between two hunks, "next" is the one below and "previous" the one
        // above — not the one above's predecessor.
        let index =
            here === undefined
                ? direction === 1
                    ? -1
                    : stops.length
                : here.inside || direction === 1
                  ? here.index
                  : here.index + 1;

        for (let tried = 0; tried < stops.length; tried++) {
            index = (index + direction + stops.length) % stops.length;
            const stop = stops[index];
            if (!options.unviewedOnly || !this.isStopViewed(stop)) {
                await this.open(stop);
                return true;
            }
        }

        if (!options.quiet) {
            vscode.window.setStatusBarMessage(
                'GitHawk: every change in this review has been viewed',
                4000
            );
        }
        return false;
    }

    /**
     * Puts the cursor on a change, in its diff, ready for VS Code's own Add
     * Comment — which refuses unless the cursor is inside one of the ranges
     * the review offers, and says so in words that do not say why.
     *
     * The change is the one given (a CodeLens, a tree row), else the one the
     * reader is on. Its diff is opened if it is not the editor in front, and
     * a cursor on a line of context, or on a deleted line the inline diff
     * cannot put a cursor on, is moved onto the change itself. Returns why
     * not, when it cannot.
     */
    async prepareComment(
        target?: { file: FileNode; hunk?: Hunk }
    ): Promise<
        | string
        | {
              path: string;
              line: number;
              range: { start: number; end: number };
              /** What the change is, in a line: the code it starts with, and where. */
              summary: string;
          }
    > {
        if (!this.review || !this.active) {
            return `No review is on screen. Start one with ${keys('⇧R')}.`;
        }
        const stop = target ?? this.currentStop();
        if (!stop) {
            return `Open a change first: click one in the Changes view, or press ${keys(']')}.`;
        }
        const hunk = stop.hunk ?? this.hunksOf(stop.file)?.[0];
        if (!hunk) {
            return `${stop.file.change.path} has no lines to comment on — a binary file, or a rename with no edits.`;
        }

        let editor = vscode.window.activeTextEditor;
        let located = editor ? this.locate(editor.document.uri) : undefined;
        if (located?.file !== stop.file) {
            await this.open({ file: stop.file, hunk });
            editor = vscode.window.activeTextEditor;
            located = editor ? this.locate(editor.document.uri) : undefined;
        }
        if (!editor || located?.file !== stop.file) {
            log.warn(
                `comment: the editor in front is ${editor?.document.uri.toString() ?? 'none'}, not a side of ${stop.file.change.path}'s diff`
            );
            return `GitHawk could not find the diff of ${stop.file.change.path} to comment in.`;
        }

        const range = located.side === 'new' ? hunkNewRange(hunk) : hunkOldRange(hunk);
        const cursor = editor.selection.active.line + 1;
        const line =
            cursor >= range.start && cursor <= range.end
                ? cursor
                : Math.min(hunkFocusLine(hunk, located.side), editor.document.lineCount);
        if (line !== cursor) {
            const at = new vscode.Position(line - 1, 0);
            editor.selection = new vscode.Selection(at, at);
            editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
        // Next and previous carry on from the change just commented on.
        this.lastStop = { path: stop.file.change.path, hunkId: hunk.id };
        log.info(
            `comment: ${stop.file.change.path} line ${line} (${located.side} side, change at ${range.start}–${range.end}) in ${editor.document.uri.toString()}`
        );
        return { path: stop.file.change.path, line, range, summary: summarise(hunk, located.side) };
    }

    // ---- Comments, in reading order ----------------------------------------

    /**
     * The review's comments in the order a reader meets them: by the tree's
     * order of files, then down each file. A comment on lines the review no
     * longer shows — the file left the changeset — is left out.
     */
    orderedComments(): { comment: ReviewComment; file: FileNode; index: number }[] {
        if (!this.review || !this.active) {
            return [];
        }
        const files = this.deps.tree.files;
        return this.review.comments
            .filter((comment) => comment.resolvedAt === undefined)
            .map((comment) => {
                const index = files.findIndex(
                    (file) =>
                        file.change.path === comment.path &&
                        (comment.side === 'new' ? file.targetRev : file.baseRev) === comment.rev
                );
                return { comment, file: files[index], index };
            })
            .filter((entry) => entry.index >= 0)
            .sort((a, b) => a.index - b.index || a.comment.line - b.comment.line);
    }

    /**
     * The next comment after the reader's place — or before it — wrapping
     * at the ends. The place is the cursor in a diff of the review, else the
     * last stop visited.
     */
    commentFrom(
        direction: 1 | -1
    ): { comment: ReviewComment; file: FileNode; position: number; of: number } | undefined {
        const ordered = this.orderedComments();
        if (ordered.length === 0) {
            return undefined;
        }
        const editor = vscode.window.activeTextEditor;
        const located = editor ? this.locate(editor.document.uri) : undefined;
        const files = this.deps.tree.files;
        const here = located
            ? { index: files.indexOf(located.file), line: editor!.selection.active.line + 1 }
            : this.lastStop
              ? { index: files.findIndex((file) => file.change.path === this.lastStop!.path), line: 0 }
              : { index: -1, line: 0 };
        type Entry = (typeof ordered)[number];
        const after = (entry: Entry) =>
            entry.index > here.index || (entry.index === here.index && entry.comment.line > here.line);
        const before = (entry: Entry) =>
            entry.index < here.index || (entry.index === here.index && entry.comment.line < here.line);
        const chosen =
            direction === 1
                ? (ordered.find(after) ?? ordered[0])
                : ([...ordered].reverse().find(before) ?? ordered[ordered.length - 1]);
        return {
            comment: chosen.comment,
            file: chosen.file,
            position: ordered.indexOf(chosen) + 1,
            of: ordered.length,
        };
    }

    /** Opens a comment's change in the diff, the cursor on its line. */
    async openComment(file: FileNode, comment: ReviewComment): Promise<void> {
        const hunk = this.hunksOf(file)?.find((candidate) => {
            const range = comment.side === 'new' ? hunkNewRange(candidate) : hunkOldRange(candidate);
            return range.start <= comment.endLine && comment.line <= range.end;
        });
        this.lastStop = { path: file.change.path, hunkId: hunk?.id };
        await this.deps.openFile({
            path: file.change.path,
            previousPath: file.change.previousPath,
            baseRev: file.baseRev,
            targetRev: file.targetRev,
            line: comment.line,
        });
        void this.deps.tree.revealRow(hunk ? this.deps.tree.hunkNode(file, hunk) : file);
    }

    /** Comments on one hunk, for its row in the tree. */
    commentCount(file: FileNode, hunk: Hunk): number {
        if (!this.review) {
            return 0;
        }
        return this.review.comments.filter((comment) => {
            if (comment.resolvedAt !== undefined || comment.path !== file.change.path) {
                return false;
            }
            if ((comment.side === 'new' ? file.targetRev : file.baseRev) !== comment.rev) {
                return false;
            }
            const range = comment.side === 'new' ? hunkNewRange(hunk) : hunkOldRange(hunk);
            return range.start <= comment.endLine && comment.line <= range.end;
        }).length;
    }

    /**
     * Opens one hunk of a file, or the file, and selects its row. From the
     * tree the keyboard stays in the tree, so arrows, Enter and Space carry
     * on there — the way the Source Control view behaves.
     */
    async openStop(file: FileNode, hunk?: Hunk, options: { preserveFocus?: boolean } = {}): Promise<void> {
        await this.open({ file, hunk }, options);
    }

    private async open(stop: Stop, options: { preserveFocus?: boolean } = {}): Promise<void> {
        const { file, hunk } = stop;
        this.lastStop = { path: file.change.path, hunkId: hunk?.id };
        await this.deps.openFile({
            path: file.change.path,
            previousPath: file.change.previousPath,
            baseRev: file.baseRev,
            targetRev: file.targetRev,
            line: hunk ? hunkFocusLine(hunk) : undefined,
            preserveFocus: options.preserveFocus,
        });
        void this.deps.tree.revealRow(hunk ? this.deps.tree.hunkNode(file, hunk) : file);
        this.decorate();
    }

    /** Every hunk of every file, in tree order; a file with none is one stop. */
    private stops(): Stop[] {
        return this.deps.tree.files.flatMap((file) => {
            const hunks = this.hunksOf(file);
            return hunks && hunks.length > 0
                ? hunks.map((hunk) => ({ file, hunk }))
                : [{ file }];
        });
    }

    /**
     * Where the reader is among the stops: the cursor's hunk when a diff of
     * a reviewed file has focus, otherwise the last stop visited.
     */
    private position(stops: Stop[]): { index: number; inside: boolean } | undefined {
        const editor = vscode.window.activeTextEditor;
        const located = editor ? this.locate(editor.document.uri) : undefined;
        if (editor && located) {
            const line = editor.selection.active.line + 1;
            let found: { index: number; inside: boolean } | undefined;
            stops.forEach((stop, index) => {
                if (stop.file !== located.file) {
                    return;
                }
                if (!stop.hunk) {
                    found = { index, inside: true };
                    return;
                }
                const range =
                    located.side === 'new' ? hunkNewRange(stop.hunk) : hunkOldRange(stop.hunk);
                if (range.start <= line) {
                    found = { index, inside: line <= range.end };
                }
            });
            if (found) {
                return found;
            }
            // Above the file's first hunk: just before it.
            const first = stops.findIndex((stop) => stop.file === located.file);
            return first >= 0 ? { index: first - 1, inside: false } : undefined;
        }

        if (this.lastStop) {
            const index = stops.findIndex(
                (stop) =>
                    stop.file.change.path === this.lastStop!.path &&
                    stop.hunk?.id === this.lastStop!.hunkId
            );
            return index >= 0 ? { index, inside: true } : undefined;
        }
        return undefined;
    }

    /** The stop the reader is on: under the cursor, else the tree's selection, else the last visited. */
    currentStop(): Stop | undefined {
        const editor = vscode.window.activeTextEditor;
        const located = editor ? this.locate(editor.document.uri) : undefined;
        if (editor && located) {
            const stops = this.stops();
            const here = this.position(stops);
            if (here && here.index >= 0 && stops[here.index]?.file === located.file) {
                return stops[here.index];
            }
        }

        const selected = this.deps.tree.selection;
        if (selected?.kind === 'hunk') {
            return { file: selected.file, hunk: selected.hunk };
        }
        if (selected?.kind === 'file') {
            return { file: selected };
        }

        if (this.lastStop) {
            return this.stops().find(
                (stop) =>
                    stop.file.change.path === this.lastStop!.path &&
                    stop.hunk?.id === this.lastStop!.hunkId
            );
        }
        return undefined;
    }

    /**
     * Which row of the review a document belongs to, and which side of its
     * diff it is. A file on disk is the newer side of whichever row compares
     * against the disk; a revision is matched on both its revision and path.
     */
    locate(uri: vscode.Uri): Located | undefined {
        if (!this.active) {
            return undefined;
        }
        const files = this.deps.tree.files;
        if (uri.scheme === 'file') {
            const path = this.deps.relativePath(uri.fsPath);
            if (path === undefined) {
                return undefined;
            }
            const file = files.find(
                (node) => node.targetRev === undefined && node.change.path === path
            );
            return file ? { file, side: 'new' } : undefined;
        }
        if (uri.scheme === REVISION_SCHEME) {
            const { rev, path } = decodeRevisionUri(uri);
            const newer = files.find(
                (node) => node.targetRev === rev && node.change.path === path
            );
            if (newer) {
                return { file: newer, side: 'new' };
            }
            const older = files.find(
                (node) =>
                    node.baseRev === rev && (node.change.previousPath ?? node.change.path) === path
            );
            return older ? { file: older, side: 'old' } : undefined;
        }
        return undefined;
    }

    // ---- What is on screen -----------------------------------------------

    /** The Changes view changed what it shows: is it a changeset under review? */
    private shown(comparison: ComparisonDto | undefined): void {
        const root = this.deps.repositoryRoot();
        const match =
            root && comparison
                ? this.reviewsOf(root).find((review) => sameSpec(comparison.spec, review.spec))
                : undefined;
        if (match?.id !== this.review?.id) {
            this.hunks.clear();
            this.lastStop = undefined;
        }

        this.review = match;
        this.active = match !== undefined;
        this.loading = this.active ? this.loadHunks() : Promise.resolve();
        this.deps.tree.setReview(this.active ? this : undefined);
        this.noteOthers();
        this.decorate();
        void this.setContexts();
        this.changed.fire();
    }

    /** Under a changeset not being reviewed: the ones that are, and how to start this one. */
    private noteOthers(): void {
        const waiting = this.entries().filter((entry) => !entry.onScreen).length;
        this.deps.tree.setReviewNote(
            !this.active && waiting > 0
                ? `${waiting === 1 ? 'A review is' : `${waiting} reviews are`} in progress — see Reviews below. ${keys('⇧R')} starts one of this.`
                : undefined
        );
    }

    /**
     * Reads every file's hunks, a few files at a time, then redraws once.
     * Superseded reads are dropped: a save mid-read starts a fresh one, and
     * the older result describes a file that no longer reads that way.
     */
    private async loadHunks(): Promise<void> {
        const ticket = ++this.loadTicket;
        const files = this.deps.tree.files;
        const reader = this.deps.hunkReader();
        const loaded = new Map<string, Hunk[]>();

        let next = 0;
        const worker = async () => {
            while (next < files.length) {
                const file = files[next++];
                try {
                    loaded.set(
                        fileKey(file),
                        await reader.hunks({
                            path: file.change.path,
                            previousPath: file.change.previousPath,
                            baseRev: file.baseRev,
                            targetRev: file.targetRev,
                            untracked: file.group === 'untracked',
                        })
                    );
                } catch (error) {
                    // One unreadable file costs its own hunks, never the review.
                    log.warn(`could not read the hunks of ${file.change.path}: ${String(error)}`);
                    loaded.set(fileKey(file), []);
                }
            }
        };
        await Promise.all(Array.from({ length: HUNK_READS_AT_ONCE }, worker));

        if (ticket !== this.loadTicket || !this.active) {
            return;
        }
        this.hunks = loaded;
        this.deps.tree.refreshReview();
        this.decorate();
        this.changed.fire();
    }

    /**
     * The hunk ids a file is made of, for the domain's rules. A file with no
     * text hunks — binary, a pure rename — is one whole-file stop. Undefined
     * while the file has not been read.
     */
    reviewedFile(file: FileNode): ReviewedFile | undefined {
        const hunks = this.hunksOf(file);
        if (!hunks) {
            return undefined;
        }
        const { change } = file;
        return {
            path: change.path,
            hunkIds:
                hunks.length > 0
                    ? hunks.map((hunk) => hunk.id)
                    : [
                          wholeFileHunkId(
                              change.path,
                              `${change.status}:${change.insertions}:${change.deletions}`
                          ),
                      ],
        };
    }

    /**
     * Marks each hunk in a visible diff of a reviewed file, on its first
     * changed line: what the tree's checkbox says, said where the code is.
     */
    decorate(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            let located = this.review ? this.locate(editor.document.uri) : undefined;
            // One side carries the markers, or every hunk is announced twice.
            // The newer side, unless there is no newer side.
            if (located?.side === 'old' && located.file.change.status !== 'deleted') {
                located = undefined;
            }
            const hunks = located ? (this.hunksOf(located.file) ?? []) : [];
            const viewed: vscode.DecorationOptions[] = [];
            const unviewed: vscode.DecorationOptions[] = [];
            for (const hunk of hunks) {
                const line = hunkFocusLine(hunk, located!.side) - 1;
                if (line >= editor.document.lineCount) {
                    continue;
                }
                (this.isViewed(located!.file, hunk) ? viewed : unviewed).push({
                    range: new vscode.Range(line, 0, line, 0),
                });
            }
            editor.setDecorations(this.viewedMarker, viewed);
            editor.setDecorations(this.unviewedMarker, unviewed);
        }
    }

    /** A hunk named the way a CodeLens names it: path, section, id. */
    findHunk(path: string, group: string | null, hunkId: string): Stop | undefined {
        const file = this.deps.tree.files.find(
            (node) => node.change.path === path && (node.group ?? null) === group
        );
        const hunk = file ? this.hunksOf(file)?.find((candidate) => candidate.id === hunkId) : undefined;
        return file && hunk ? { file, hunk } : undefined;
    }

    async toggleHunk(path: string, group: string | null, hunkId: string): Promise<void> {
        const stop = this.findHunk(path, group, hunkId);
        if (stop?.hunk) {
            this.mark(stop.file, stop.hunk, !this.isViewed(stop.file, stop.hunk));
            await this.saveAndRedraw();
        }
    }

    /** Commits a change to the review — from the comments, for one — and redraws. */
    async update(change: (review: Review) => Review): Promise<void> {
        if (!this.review) {
            return;
        }
        this.review = change(this.review);
        await this.saveAndRedraw();
    }

    /** The same, for any review — the Reviews view acts on ones not on screen. */
    async updateReview(id: string, change: (review: Review) => Review): Promise<void> {
        if (this.review?.id === id) {
            await this.update(change);
            return;
        }
        const entry = this.find(id);
        if (!entry) {
            return;
        }
        await this.store(entry.root, (reviews) =>
            reviews.map((review) => (review.id === id ? change(review) : review))
        );
        this.changed.fire();
    }

    /**
     * What an agent wrote back, from a repository's replies file, applied to
     * whichever of its reviews the comments belong to. Returns each review
     * that gained an answer, with the comments answered.
     */
    async takeAgentReplies(
        root: string,
        replies: readonly AgentReply[]
    ): Promise<{ review: Review; answered: string[] }[]> {
        const results: { review: Review; answered: string[] }[] = [];
        for (const entry of this.entries().filter((candidate) => candidate.root === root)) {
            const applied = applyAgentReplies(entry.review, replies, {
                now: new Date(),
                idFor: (reply) => `agent:${hunkId(reply.comment, [reply.status ?? '', reply.reply.trim()])}`,
            });
            if (applied.answered.length > 0) {
                await this.updateReview(entry.review.id, () => applied.review);
                results.push({ review: applied.review, answered: applied.answered });
            }
        }
        return results;
    }

    /** A review by id, wherever it is. */
    reviewById(id: string): Review | undefined {
        return this.find(id)?.review;
    }

    private async saveAndRedraw(): Promise<void> {
        await this.save();
        this.deps.tree.refreshReview();
        this.decorate();
        this.changed.fire();
    }

    private stored(): Record<string, Review[]> {
        const stored = this.deps.store.get<Record<string, Review[] | Review>>(STORE_KEY, {});
        // Reviews were one per repository before there could be several;
        // a review left over from then is still a review in progress.
        return Object.fromEntries(
            Object.entries(stored).map(([root, value]) => [
                root,
                (Array.isArray(value) ? value : [value]).map((review) => ({
                    ...review,
                    id: review.id ?? `${root}:${review.startedAt}`,
                })),
            ])
        );
    }

    private async store(root: string, change: (reviews: Review[]) => Review[]): Promise<void> {
        const all = { ...this.stored() };
        const next = change(all[root] ?? []);
        if (next.length > 0) {
            all[root] = next;
        } else {
            delete all[root];
        }
        await this.deps.store.update(STORE_KEY, all);
    }

    /** Writes the review on screen back, with how far through it the reader now is. */
    private async save(): Promise<void> {
        const review = this.review;
        if (!review) {
            return;
        }
        const files = this.deps.tree.files
            .map((file) => this.reviewedFile(file))
            .filter((file): file is ReviewedFile => file !== undefined);
        const snapshot =
            this.active && files.length > 0
                ? { ...review, progress: reviewProgress(review, files) }
                : review;
        this.review = snapshot;
        await this.store(review.root, (reviews) =>
            reviews.some((candidate) => candidate.id === review.id)
                ? reviews.map((candidate) => (candidate.id === review.id ? snapshot : candidate))
                : [...reviews, snapshot]
        );
    }

    private async setContexts(): Promise<void> {
        await vscode.commands.executeCommand('setContext', REVIEWING_CONTEXT, this.active);
        await vscode.commands.executeCommand(
            'setContext',
            HAS_REVIEWS_CONTEXT,
            this.entries().length > 0
        );
    }

    /**
     * What the Reviews view calls a review. A hash says nothing to someone
     * picking among three reviews; the commit's subject does.
     */
    private async labelFor(comparison: ComparisonDto): Promise<string> {
        const { spec, label } = comparison;
        const newest =
            spec.kind === 'singleCommit'
                ? spec.hash
                : spec.kind === 'commitRange'
                  ? spec.newest
                  : undefined;
        const subject = newest ? await this.deps.commitSubject(newest).catch(() => undefined) : undefined;
        if (!subject) {
            return label;
        }
        return spec.kind === 'singleCommit'
            ? `${label} ${subject}`
            : `${label} — up to “${subject}”`;
    }

    /** A branch or tag resolved to its commit; anything git cannot resolve stays as it is. */
    private async resolve(rev: string): Promise<string> {
        if (rev.startsWith(':')) {
            return rev;
        }
        try {
            return await this.deps.resolveRevision(rev);
        } catch {
            return rev;
        }
    }

    /** See gitHawk.review.state: the review as the tree and the editor see it. */
    stateForTesting() {
        return {
            active: this.active,
            review: this.review,
            reviews: this.entries().map((entry) => ({
                id: entry.review.id,
                label: entry.review.label,
                root: entry.root,
                onScreen: entry.onScreen,
            })),
            progress: this.progress(),
            files: this.deps.tree.files.map((file) => ({
                path: file.change.path,
                group: file.group,
                state: this.fileState(file),
                hunks: (this.hunksOf(file) ?? []).map((hunk) => ({
                    id: hunk.id,
                    newStart: hunk.newStart,
                    viewed: this.isViewed(file, hunk),
                })),
            })),
        };
    }
}

/**
 * A change in one line, for the comment box: its first changed line on the
 * side being read, and the function git found it in. A line of the file is
 * no good here — the cursor is as likely on a closing brace as on the change.
 */
export function summarise(hunk: Hunk, side: 'new' | 'old'): string {
    const marker = side === 'new' && hunkInsertions(hunk) > 0 ? '+' : '-';
    const first = hunk.lines.find((line) => line.startsWith(marker))?.slice(1).trim() ?? '';
    const shown = first.length > 70 ? `${first.slice(0, 69)}…` : first;
    const counts = [
        hunkInsertions(hunk) > 0 ? `+${hunkInsertions(hunk)}` : '',
        hunkDeletions(hunk) > 0 ? `−${hunkDeletions(hunk)}` : '',
    ]
        .filter(Boolean)
        .join(' ');
    return [
        `Change ${counts}${hunk.context ? ` in ${hunk.context}` : ''}`,
        shown ? `${marker === '+' ? 'starts' : 'removes'} “${shown}”` : '',
    ]
        .filter(Boolean)
        .join(' — ');
}

/** "2/3 files · 1 comment", from the review's last snapshot. */
export function describeProgress(review: Review): string {
    const comments = review.comments.length;
    return [
        review.progress
            ? `${review.progress.filesViewed}/${review.progress.files} files`
            : 'not opened yet',
        comments > 0 ? `${comments} ${comments === 1 ? 'comment' : 'comments'}` : '',
    ]
        .filter(Boolean)
        .join(' · ');
}

/** One row's diff, as a key: the same path in two sections is two diffs. */
function fileKey(file: FileNode): string {
    return [file.group ?? '', file.change.path, file.baseRev, file.targetRev ?? ''].join('\0');
}

/** A review shortcut as the reader's platform writes it. */
export function keys(suffix: string): string {
    return `${process.platform === 'darwin' ? '⌘K' : 'Ctrl+K'} ${suffix}`;
}
