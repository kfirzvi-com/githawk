import * as vscode from 'vscode';
import { ComparisonDto } from '../../application/dto/ComparisonDto';
import type { ChangeGroupKind } from '../../domain/models/Comparison';
import {
    hunkDeletions,
    hunkInsertions,
    hunkNewRange,
    type Hunk,
} from '../../domain/models/Hunk';
import type { FileReviewState } from '../../domain/models/Review';
import {
    FileNode,
    GroupNode,
    HunkNode,
    RepositoryNode,
    RepositorySection,
    TreeNode,
    basename,
    buildComparisonTree,
    buildRepositoriesTree,
    countFiles,
    describeChange,
    filesBeneath,
    markdownTooltipSource,
} from './changedFilesTreeModel';
import { ChangeDecorationProvider, changeUri } from './ChangeDecorationProvider';

export const CHANGED_FILES_VIEW_ID = 'gitHawkChanges';
export const OPEN_DIFF_COMMAND = 'gitHawk.openChangedFile';

/**
 * Set while the tree shows the working tree. The commit box's `when` clause
 * reads it, so the box exists exactly as long as there is something it could
 * commit — and disappears with the last file.
 */
export const WORKING_TREE_SHOWN_CONTEXT = 'gitHawk.workingTreeShown';

/**
 * What a row offers, by where its file stands. The menus in package.json key
 * on these: a staged file can be unstaged, the other two staged, and a file
 * from a commit's history can only be opened.
 */
export const FILE_CONTEXT: Record<ChangeGroupKind, string> = {
    staged: 'gitHawkStagedFile',
    unstaged: 'gitHawkUnstagedFile',
    untracked: 'gitHawkUntrackedFile',
    conflicted: 'gitHawkConflictedFile',
};
export const GROUP_CONTEXT: Record<ChangeGroupKind, string> = {
    staged: 'gitHawkStagedGroup',
    unstaged: 'gitHawkUnstagedGroup',
    untracked: 'gitHawkUntrackedGroup',
    conflicted: 'gitHawkConflictedGroup',
};

export const HUNK_CONTEXT = 'gitHawkHunk';
export const REPOSITORY_CONTEXT = 'gitHawkRepository';

/**
 * What a review adds to the tree: a checkbox on every file, and the file's
 * hunks beneath it, each with a checkbox of its own. The tree asks; the
 * review answers. Nothing about what "viewed" means lives here.
 */
export interface ReviewOverlay {
    /** Undefined while the file is still being read. */
    hunksOf(file: FileNode): readonly Hunk[] | undefined;
    fileState(file: FileNode): FileReviewState;
    isViewed(file: FileNode, hunk: Hunk): boolean;
    /** Comments left on the hunk's lines. */
    commentCount(file: FileNode, hunk: Hunk): number;
    /** "3 of 7 files · 12 of 30 changes", for the view's description. */
    progress(): { text: string; unviewed: number };
    /** The shortcuts, said where the reader is already looking. */
    message(): string;
}

/**
 * Shows the changed files of the current comparison as a folder tree in the
 * primary sidebar.
 *
 * A native TreeView rather than a list inside the webview: it inherits the file
 * icon theme, keyboard navigation, collapse-all, and search, none of which would
 * be worth rebuilding. The shaping logic lives in changedFilesTreeModel so it can
 * be tested without VS Code.
 *
 * For the working tree the top level is the sections git itself keeps —
 * staged, changed, untracked, conflicted — each a folder tree of its own, with
 * stage and unstage on the rows. That makes this view the place a commit is
 * assembled, which is why the commit box sits directly above it.
 */
export class ChangedFilesTree implements vscode.TreeDataProvider<TreeNode> {
    private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    private comparison?: ComparisonDto;
    /**
     * Set while the tree shows every repository's working tree at once. The
     * comparison above is then the active repository's, which is the one a
     * review or the commit box acts on, or undefined when it has nothing.
     */
    private sections?: readonly RepositorySection[];
    private roots: TreeNode[] = [];
    /** Each node's parent, which `reveal` needs to find a node's place. */
    private parents = new Map<TreeNode, TreeNode>();
    /**
     * Part of every folder's id. VS Code remembers whether a folder is open
     * by its id, which is what keeps folders as the reader left them across
     * a refresh — and is also what stops "expand all" from being a refresh.
     * Bumping this retires every id at once, so every folder is new again
     * and opens the way a new folder does.
     */
    private generation = 0;
    private view?: vscode.TreeView<TreeNode>;
    private review?: ReviewOverlay;
    /** Said under whatever is on screen while a review waits elsewhere. */
    private reviewNote?: string;
    /**
     * One node per hunk per file row, kept so `reveal` is handed the same
     * object `getChildren` returned — the view finds a row by identity.
     */
    private hunkNodes = new WeakMap<FileNode, Map<string, HunkNode>>();
    private readonly shown = new vscode.EventEmitter<ComparisonDto | undefined>();
    /** Fires after every show and clear, with what is now on screen. */
    readonly onDidShow = this.shown.event;
    private readonly reviewToggled = new vscode.EventEmitter<boolean>();
    /**
     * Fires when a review starts or stops owning the tree. A review is of
     * one repository, so starting one narrows an all-repositories tree to it,
     * and ending one is the cue to widen it again.
     */
    readonly onDidToggleReview = this.reviewToggled.event;

    constructor(private readonly decorations: ChangeDecorationProvider) {}

    attach(view: vscode.TreeView<TreeNode>): void {
        this.view = view;
        this.describe();
    }

    get current(): ComparisonDto | undefined {
        return this.comparison;
    }

    /** See gitHawk.changesTree: the rows exactly as the view has them. */
    rootsForTesting(): TreeNode[] {
        return this.roots;
    }

    /** True while the tree shows the uncommitted changeset. */
    get showsWorkingTree(): boolean {
        return this.sections !== undefined || this.comparison?.groups !== undefined;
    }

    /** True while the tree shows several repositories, one heading each. */
    get showsRepositories(): boolean {
        return this.sections !== undefined;
    }

    /**
     * One comparison. `root` is the repository it was read from, which every
     * row then carries.
     */
    show(comparison: ComparisonDto, root?: string): void {
        this.sections = undefined;
        this.comparison = comparison;
        this.display(buildComparisonTree(comparison, root));
    }

    /** Every repository with something uncommitted, each under its own heading. */
    showRepositories(sections: readonly RepositorySection[]): void {
        this.sections = sections;
        this.comparison = sections.find((section) => section.active)?.comparison;
        this.display(buildRepositoriesTree(sections));
    }

    private display(roots: TreeNode[]): void {
        this.roots = roots;
        this.parents = parentsOf(this.roots);
        this.decorations.setChanges(
            this.roots.flatMap(filesBeneath).map((node) => ({
                change: node.change,
                group: node.group,
                root: node.root,
            }))
        );
        this.changed.fire(undefined);
        this.describe();
        this.shown.fire(this.comparison);
    }

    clear(): void {
        this.sections = undefined;
        this.comparison = undefined;
        this.roots = [];
        this.parents = new Map();
        this.decorations.clear();
        this.changed.fire(undefined);
        this.describe();
        this.shown.fire(undefined);
    }

    /**
     * Every file row, in the order the tree shows them — the order a review
     * walks. With several repositories on screen, only the active one's: a
     * review is of one repository, and its hunks are read from that one.
     */
    get files(): FileNode[] {
        const roots = this.sections
            ? this.roots.filter(
                  (node) => node.kind === 'repository' && node.active
              )
            : this.roots;
        return roots.flatMap(filesBeneath);
    }

    /** Turns review mode on for what is on screen, or off. */
    setReview(review: ReviewOverlay | undefined): void {
        const toggled = (review !== undefined) !== (this.review !== undefined);
        this.review = review;
        if (review && this.sections) {
            // A review is of one repository: the others step aside until it ends.
            const active = this.sections.find((section) => section.active);
            if (active) {
                this.show(active.comparison, active.repository.root);
            }
        }
        this.refreshReview();
        if (toggled) {
            this.reviewToggled.fire(review !== undefined);
        }
    }

    /** A line about a review in progress that is not what the view is showing. */
    setReviewNote(note: string | undefined): void {
        if (note !== this.reviewNote) {
            this.reviewNote = note;
            this.describe();
        }
    }

    /** Redraws checkboxes and hunks after the review changed under them. */
    refreshReview(): void {
        this.changed.fire(undefined);
        this.describe();
    }

    get reviewing(): boolean {
        return this.review !== undefined;
    }

    /** The row the tree has selected, if any. */
    get selection(): TreeNode | undefined {
        return this.view?.selection[0];
    }

    /** The row for one hunk of a file, the same object every time. */
    hunkNode(file: FileNode, hunk: Hunk): HunkNode {
        let nodes = this.hunkNodes.get(file);
        if (!nodes) {
            nodes = new Map();
            this.hunkNodes.set(file, nodes);
        }
        let node = nodes.get(hunk.id);
        if (!node || node.hunk !== hunk) {
            node = { kind: 'hunk', file, hunk };
            nodes.set(hunk.id, node);
        }
        return node;
    }

    /** Puts the tree's selection on a row without taking the keyboard from the editor. */
    async revealRow(node: TreeNode): Promise<void> {
        if (!this.view?.visible) {
            return;
        }
        try {
            await this.view.reveal(node, { select: true, focus: false, expand: true });
        } catch {
            // The tree was replaced underneath the reveal; the next one lands.
        }
    }

    getParent(element: TreeNode): TreeNode | undefined {
        if (element.kind === 'hunk') {
            return element.file;
        }
        return this.parents.get(element);
    }

    /**
     * The opposite of the collapse-all VS Code puts in the title bar, which
     * has no opposite of its own.
     *
     * Not a loop of `reveal({expand})` over every folder: the tree can be
     * replaced by a background refresh while that loop is awaiting, and a
     * node from the old tree then has no parent and no row. Retiring the ids
     * and redrawing is one synchronous step, so there is nothing to race.
     */
    expandAll(): void {
        this.generation += 1;
        this.changed.fire(undefined);
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (!element) {
            return this.roots;
        }
        if (element.kind === 'hunk') {
            return [];
        }
        if (element.kind === 'file') {
            return (this.review?.hunksOf(element) ?? []).map((hunk) =>
                this.hunkNode(element, hunk)
            );
        }
        return element.children;
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'repository') {
            return this.repositoryItem(node);
        }

        if (node.kind === 'group') {
            return this.groupItem(node);
        }

        if (node.kind === 'hunk') {
            return this.hunkItem(node);
        }

        if (node.kind === 'directory') {
            const item = new vscode.TreeItem(
                node.label,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.iconPath = vscode.ThemeIcon.Folder;
            const files = countFiles(node);
            item.description = `${files} ${files === 1 ? 'file' : 'files'}`;
            item.contextValue = 'gitHawkDirectory';
            // The section is part of it: the same folder can be under two.
            item.id = `${this.generation}:${node.root ?? ''}:${node.group ?? ''}:${node.path}`;
            return item;
        }

        return this.fileItem(node);
    }

    /**
     * A repository's heading. The check is the repository picker's own mark
     * for the one the graph and the commit box are pointed at; nothing here
     * changes which that is — the selector above does.
     */
    private repositoryItem(node: RepositoryNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.name,
            vscode.TreeItemCollapsibleState.Expanded
        );
        const files = countFiles(node);
        item.iconPath = new vscode.ThemeIcon(node.active ? 'check' : 'repo');
        item.description = [node.branch, `${files}`].filter(Boolean).join('  ·  ');
        item.tooltip = new vscode.MarkdownString(
            [
                `**${node.name}**${node.branch ? ` on \`${node.branch}\`` : ''}`,
                `\`${node.root}\``,
                node.active
                    ? '_Shown in the graph; the commit box commits here._'
                    : '_Switch to it with the repository selector to commit here._',
            ].join('\n\n')
        );
        item.contextValue = REPOSITORY_CONTEXT;
        item.id = `${this.generation}:repository:${node.root}`;
        return item;
    }

    private groupItem(node: GroupNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            vscode.TreeItemCollapsibleState.Expanded
        );
        const files = node.files.length;
        item.description = `${files}`;
        item.contextValue = GROUP_CONTEXT[node.group];
        item.tooltip = groupTooltip(node.group);
        // A stable id per section keeps its expanded state across reloads:
        // staging a file rebuilds the tree, and a section that folded itself
        // every time would be unusable.
        item.id = `${this.generation}:group:${node.root ?? ''}:${node.group}`;
        return item;
    }

    private fileItem(node: FileNode): vscode.TreeItem {
        const { change } = node;
        const item = new vscode.TreeItem(basename(change.path));

        // A private scheme, not file:. VS Code still resolves the icon from the
        // extension, and the decoration provider can colour these rows without
        // touching identically-named files elsewhere in the workbench.
        item.resourceUri = changeUri(change.path, node.group, node.root);
        item.description = describeChange(change);
        item.tooltip = new vscode.MarkdownString(
            markdownTooltipSource(change)
        );
        item.contextValue = node.group
            ? FILE_CONTEXT[node.group]
            : 'gitHawkChangedFile';
        item.command = {
            command: OPEN_DIFF_COMMAND,
            title: 'Open Changes',
            arguments: [node],
        };

        if (this.review) {
            this.reviewFileItem(item, node);
        }
        return item;
    }

    /**
     * A file under review: ticked when every hunk in it has been read, and
     * open, so its hunks are a row each. The checkbox is VS Code's own, which
     * is what makes Space tick the focused row with no binding of ours.
     */
    private reviewFileItem(item: vscode.TreeItem, node: FileNode): void {
        const review = this.review!;
        const state = review.fileState(node);
        const hunks = review.hunksOf(node) ?? [];

        item.checkboxState = {
            state:
                state === 'viewed'
                    ? vscode.TreeItemCheckboxState.Checked
                    : vscode.TreeItemCheckboxState.Unchecked,
            tooltip: state === 'viewed' ? 'Viewed — untick to read it again' : 'Mark every change in this file viewed',
        };
        if (hunks.length > 0) {
            const seen = hunks.filter((hunk) => review.isViewed(node, hunk)).length;
            item.description = `${describeChange(node.change)}  ·  ${seen}/${hunks.length}`;
            item.collapsibleState =
                state === 'viewed'
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Expanded;
        }
        // An id makes VS Code remember the row's fold across a refresh. The
        // state is in it so that finishing a file folds it away — GitHub's
        // "viewed" does the same — and unticking opens it again.
        item.id = `${this.generation}:${node.root ?? ''}:${node.group ?? ''}:file:${node.change.path}:${state === 'viewed' ? 'v' : 'o'}`;
    }

    private hunkItem(node: HunkNode): vscode.TreeItem {
        const { hunk, file } = node;
        const range = hunkNewRange(hunk);
        const label =
            hunk.newLines === 0
                ? `Removed at line ${range.start}`
                : range.start === range.end
                  ? `Line ${range.start}`
                  : `Lines ${range.start}–${range.end}`;
        const item = new vscode.TreeItem(label);
        const counts = [
            hunkInsertions(hunk) > 0 ? `+${hunkInsertions(hunk)}` : '',
            hunkDeletions(hunk) > 0 ? `−${hunkDeletions(hunk)}` : '',
        ]
            .filter(Boolean)
            .join(' ');
        const comments = this.review?.commentCount(file, hunk) ?? 0;
        item.description = [comments > 0 ? `💬 ${comments}` : '', hunk.context, counts]
            .filter(Boolean)
            .join('  ');
        const viewed = this.review?.isViewed(file, hunk) ?? false;
        item.checkboxState = {
            state: viewed
                ? vscode.TreeItemCheckboxState.Checked
                : vscode.TreeItemCheckboxState.Unchecked,
            tooltip: viewed ? 'Viewed' : 'Mark this change viewed',
        };
        const shown = hunk.lines.slice(0, 24);
        if (hunk.lines.length > shown.length) {
            shown.push('…');
        }
        item.tooltip = new vscode.MarkdownString(['```diff', ...shown, '```'].join('\n'));
        item.contextValue = HUNK_CONTEXT;
        item.id = `${this.generation}:${file.group ?? ''}:hunk:${file.change.path}:${hunk.id}`;
        item.command = {
            command: OPEN_DIFF_COMMAND,
            title: 'Open This Change',
            arguments: [file, hunk],
        };
        return item;
    }

    /**
     * The view's own title, description, and message carry the comparison's
     * context, so it sits next to the files it describes instead of being
     * duplicated in the webview.
     */
    private describe(): void {
        void vscode.commands.executeCommand(
            'setContext',
            WORKING_TREE_SHOWN_CONTEXT,
            this.showsWorkingTree
        );

        if (!this.view) {
            return;
        }

        if (this.sections) {
            this.describeRepositories(this.sections);
            return;
        }

        if (!this.comparison) {
            this.view.title = 'Changes';
            this.view.description = undefined;
            this.view.message = [
                'Select a commit in the Git Graph panel, or compare two branches, to see what changed.',
                this.reviewNote,
            ]
                .filter(Boolean)
                .join('\n\n');
            this.view.badge = undefined;
            return;
        }

        const { totals, label, methodExplanation, skipped } = this.comparison;

        this.view.title = label;
        this.view.description = `${totals.files} ${
            totals.files === 1 ? 'file' : 'files'
        }  +${totals.insertions} −${totals.deletions}`;

        const notes = [methodExplanation];
        if (skipped.length > 0) {
            notes.push(
                `${
                    skipped.length === 1
                        ? '1 commit was'
                        : `${skipped.length} commits were`
                } left out — ${skipped
                    .map((entry) => `${entry.hash.slice(0, 8)} ${entry.reason}`)
                    .join('; ')}`
            );
        }
        if (this.reviewNote) {
            notes.push(this.reviewNote);
        }
        this.view.message = notes.join('\n\n');

        this.view.badge = {
            value: totals.files,
            tooltip: `${totals.files} changed files`,
        };

        if (this.review) {
            const progress = this.review.progress();
            this.view.title = 'Review';
            this.view.description = progress.text;
            this.view.message = this.review.message();
            this.view.badge =
                progress.unviewed > 0
                    ? { value: progress.unviewed, tooltip: `${progress.unviewed} changes not viewed yet` }
                    : undefined;
        }
    }

    /** Totals across every repository on screen. */
    private describeRepositories(sections: readonly RepositorySection[]): void {
        const view = this.view!;
        const files = sections.reduce((sum, section) => sum + section.comparison.totals.files, 0);
        const insertions = sections.reduce((sum, section) => sum + section.comparison.totals.insertions, 0);
        const deletions = sections.reduce((sum, section) => sum + section.comparison.totals.deletions, 0);

        view.title = 'Uncommitted changes';
        view.description = `${plural(files, 'file', 'files')} in ${plural(sections.length, 'repository', 'repositories')}  +${insertions} −${deletions}`;
        view.message = this.reviewNote;
        view.badge = { value: files, tooltip: `${files} changed files` };
    }
}

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

function groupTooltip(kind: ChangeGroupKind): string {
    switch (kind) {
        case 'conflicted':
            return 'Files with unresolved merge conflicts. Resolve and stage them before committing.';
        case 'staged':
            return 'What the next commit will contain. Compared: HEAD against the index.';
        case 'unstaged':
            return 'Tracked files changed on disk but not staged. Compared: the index against the file on disk.';
        case 'untracked':
            return 'Files git does not track yet. Stage one to include it in the next commit.';
    }
}

function parentsOf(roots: TreeNode[]): Map<TreeNode, TreeNode> {
    const parents = new Map<TreeNode, TreeNode>();
    const walk = (node: TreeNode) => {
        if (node.kind === 'file' || node.kind === 'hunk') {
            return;
        }
        for (const child of node.children) {
            parents.set(child, node);
            walk(child);
        }
    };
    roots.forEach(walk);
    return parents;
}
