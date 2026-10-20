import * as vscode from 'vscode';
import type { ComparisonDto } from '../../application/dto/ComparisonDto';
import type { ComparisonSpec } from '../../domain/models/Comparison';
import { hunkFocusLine, hunkNewRange, hunkOldRange, type Hunk } from '../../domain/models/Hunk';
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
    type Review,
    type ReviewedFile,
} from '../../domain/models/Review';
import type { IHunkReader } from '../../domain/repositories/IHunkReader';
import type { ChangedFilesTree, ReviewOverlay } from './ChangedFilesTree';
import type { FileNode, TreeNode } from './changedFilesTreeModel';
import type { OpenFileRequest } from './ComparisonController';
import { REVISION_SCHEME, decodeRevisionUri } from './RevisionContentProvider';
import { log } from './log';

/** Workspace state: every repository's review in progress, by root. */
const STORE_KEY = 'gitHawk.reviews';

/** Set while the Changes view is showing the changeset under review. */
export const REVIEWING_CONTEXT = 'gitHawk.reviewing';
/** Set while a review exists for this repository but something else is on screen. */
export const REVIEW_PAUSED_CONTEXT = 'gitHawk.reviewPaused';

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
    showWorkingTree: () => Promise<void>;
    openFile: (request: OpenFileRequest) => Promise<void>;
}

/**
 * Review mode for the Changes view.
 *
 * Owns the review of the active repository and keeps three things in step
 * with it: the tree's checkboxes and hunk rows, the markers in the diff
 * editor, and the review's copy in workspace state — which is what lets a
 * review be left for another commit, or a window reload, and picked up where
 * it stopped.
 *
 * Everything that decides what "viewed" means is in the domain's Review; this
 * class only asks it and draws the answer.
 */
export class ReviewController implements vscode.Disposable, ReviewOverlay {
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

    private readonly viewedMarker = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: '  ✓ viewed',
            color: new vscode.ThemeColor('descriptionForeground'),
            fontStyle: 'italic',
        },
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
    private readonly unviewedMarker = vscode.window.createTextEditorDecorationType({
        after: {
            contentText: `  ○ not viewed — ${keys('⇧V')} marks it`,
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            fontStyle: 'italic',
        },
        overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
        overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

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
            `${keys(']')} next   ${keys('⇧V')} viewed   ${keys('⇧C')} comment   ${keys('⇧S')} send to AI`,
        ].join('\n');
    }

    // ---- Starting, resuming, ending --------------------------------------

    /**
     * Starts reviewing what the Changes view shows — or, with nothing shown,
     * the uncommitted changes — or returns to the review already under way.
     * Pressed again mid-review it goes to the next change not yet viewed,
     * so the one key both opens a review and moves through it.
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
        if (this.review && (!comparison || sameSpec(comparison.spec, this.review.spec))) {
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

        if (this.review) {
            const choice = await vscode.window.showWarningMessage(
                `A review of “${this.review.label}” is in progress.`,
                {
                    modal: true,
                    detail: `Reviewing “${comparison.label}” instead discards it: ${this.describeLoss(this.review)}.`,
                },
                'Resume That Review',
                'Review This Instead'
            );
            if (choice === 'Resume That Review') {
                await this.resume();
                return;
            }
            if (choice !== 'Review This Instead') {
                return;
            }
        }

        const spec = pinSpec(comparison.spec, {
            baseRev: await this.resolve(comparison.baseRev),
            targetRev:
                comparison.targetRev === undefined
                    ? undefined
                    : await this.resolve(comparison.targetRev),
        });
        this.review = startReview({ root, label: comparison.label, spec, now: new Date() });
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

    /** Puts the review's changeset back in the Changes view. */
    async resume(): Promise<void> {
        if (!this.review) {
            return;
        }
        await this.deps.showComparison(this.review.spec);
        await this.whenLoaded();
    }

    /**
     * Ends the review and forgets it. Says what goes with it first: viewed
     * marks and unsent comments are work, and neither is anywhere else.
     */
    async end(options: { confirmed?: boolean } = {}): Promise<boolean> {
        const review = this.review;
        if (!review) {
            return false;
        }
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
        this.review = undefined;
        this.active = false;
        this.hunks.clear();
        await this.save();
        this.deps.tree.setReview(undefined);
        this.deps.tree.setReviewNote(undefined);
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

    /** Opens one hunk of a file, or the file, and selects its row. */
    async openStop(file: FileNode, hunk?: Hunk): Promise<void> {
        await this.open({ file, hunk });
    }

    private async open(stop: Stop): Promise<void> {
        const { file, hunk } = stop;
        this.lastStop = { path: file.change.path, hunkId: hunk?.id };
        await this.deps.openFile({
            path: file.change.path,
            previousPath: file.change.previousPath,
            baseRev: file.baseRev,
            targetRev: file.targetRev,
            line: hunk ? hunkFocusLine(hunk) : undefined,
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

    /** The Changes view changed what it shows: is it the review's changeset? */
    private shown(comparison: ComparisonDto | undefined): void {
        const root = this.deps.repositoryRoot();
        if (this.review?.root !== root) {
            this.review = root ? this.stored()[root] : undefined;
            this.hunks.clear();
        }

        const active =
            this.review !== undefined &&
            comparison !== undefined &&
            sameSpec(comparison.spec, this.review.spec);

        this.active = active;
        if (active) {
            this.loading = this.loadHunks();
        } else {
            this.hunks.clear();
            this.loading = Promise.resolve();
        }
        this.deps.tree.setReview(active ? this : undefined);
        this.deps.tree.setReviewNote(
            this.review && !active
                ? `Your review of ${this.review.label} is waiting — ${keys('⇧R')} returns to it.`
                : undefined
        );
        this.decorate();
        void this.setContexts();
        this.changed.fire();
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
            const viewed: vscode.Range[] = [];
            const unviewed: vscode.Range[] = [];
            for (const hunk of hunks) {
                const line = hunkFocusLine(hunk, located!.side) - 1;
                if (line >= editor.document.lineCount) {
                    continue;
                }
                const range = new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER);
                (this.isViewed(located!.file, hunk) ? viewed : unviewed).push(range);
            }
            editor.setDecorations(this.viewedMarker, viewed);
            editor.setDecorations(this.unviewedMarker, unviewed);
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

    private async saveAndRedraw(): Promise<void> {
        await this.save();
        this.deps.tree.refreshReview();
        this.decorate();
        this.changed.fire();
    }

    private stored(): Record<string, Review> {
        return this.deps.store.get<Record<string, Review>>(STORE_KEY, {});
    }

    private async save(): Promise<void> {
        const root = this.deps.repositoryRoot();
        if (!root) {
            return;
        }
        const all = { ...this.stored() };
        if (this.review) {
            all[root] = this.review;
        } else {
            delete all[root];
        }
        await this.deps.store.update(STORE_KEY, all);
    }

    private async setContexts(): Promise<void> {
        await vscode.commands.executeCommand('setContext', REVIEWING_CONTEXT, this.active);
        await vscode.commands.executeCommand(
            'setContext',
            REVIEW_PAUSED_CONTEXT,
            this.review !== undefined && !this.active
        );
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

/** One row's diff, as a key: the same path in two sections is two diffs. */
function fileKey(file: FileNode): string {
    return [file.group ?? '', file.change.path, file.baseRev, file.targetRev ?? ''].join('\0');
}

/** A review shortcut as the reader's platform writes it. */
export function keys(suffix: string): string {
    return `${process.platform === 'darwin' ? '⌘K' : 'Ctrl+K'} ${suffix}`;
}
