import * as vscode from 'vscode';
import { ComparisonDto } from '../../application/dto/ComparisonDto';
import type { ChangeGroupKind } from '../../domain/models/Comparison';
import {
    FileNode,
    GroupNode,
    TreeNode,
    basename,
    buildComparisonTree,
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
        return this.comparison?.groups !== undefined;
    }

    show(comparison: ComparisonDto): void {
        this.comparison = comparison;
        this.roots = buildComparisonTree(comparison);
        this.parents = parentsOf(this.roots);
        this.decorations.setChanges(
            this.roots.flatMap(filesBeneath).map((node) => ({
                change: node.change,
                group: node.group,
            }))
        );
        this.changed.fire(undefined);
        this.describe();
    }

    clear(): void {
        this.comparison = undefined;
        this.roots = [];
        this.parents = new Map();
        this.decorations.clear();
        this.changed.fire(undefined);
        this.describe();
    }

    getParent(element: TreeNode): TreeNode | undefined {
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
        return element.kind === 'file' ? [] : element.children;
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'group') {
            return this.groupItem(node);
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
            item.id = `${this.generation}:${node.group ?? ''}:${node.path}`;
            return item;
        }

        return this.fileItem(node);
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
        item.id = `${this.generation}:group:${node.group}`;
        return item;
    }

    private fileItem(node: FileNode): vscode.TreeItem {
        const { change } = node;
        const item = new vscode.TreeItem(basename(change.path));

        // A private scheme, not file:. VS Code still resolves the icon from the
        // extension, and the decoration provider can colour these rows without
        // touching identically-named files elsewhere in the workbench.
        item.resourceUri = changeUri(change.path, node.group);
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

        if (!this.comparison) {
            this.view.title = 'Changes';
            this.view.description = undefined;
            this.view.message =
                'Select a commit in the Git Graph panel, or compare two branches, to see what changed.';
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
        this.view.message = notes.join('\n\n');

        this.view.badge = {
            value: totals.files,
            tooltip: `${totals.files} changed files`,
        };
    }
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
        if (node.kind === 'file') {
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
