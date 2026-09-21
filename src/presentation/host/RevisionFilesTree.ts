import * as vscode from 'vscode';
import { encodeRevisionUri } from './RevisionContentProvider';
import {
    RevisionNode,
    basename,
    buildRevisionTree,
    countFiles,
} from './revisionFilesTreeModel';

export const REVISION_FILES_VIEW_ID = 'gitHawkFiles';
export const OPEN_FILE_AT_REVISION_COMMAND = 'gitHawk.openFileAtRevision';

/**
 * Set while the tree shows a revision. The view's `when` clause reads it, so
 * the Files view exists exactly as long as there is a revision to show — and
 * leaves the sidebar alone the rest of the time.
 */
export const REVISION_SHOWN_CONTEXT = 'gitHawk.revisionShown';

/** What the tree is showing, as a command can ask for it. */
export interface BrowsedRevision {
    /** The full commit hash, whatever name it was asked for by. */
    hash: string;
    /** The first line of the commit message, when the commit is in the loaded history. */
    subject?: string;
    paths: string[];
}

/**
 * Shows every file of the project as it was at one commit, as a folder tree
 * in the primary sidebar — the Explorer, pointed at the past.
 *
 * A native TreeView for the reason the Changes tree is one: it inherits the
 * file icon theme, keyboard navigation, collapse-all, and type-to-filter.
 * Clicking a file opens that commit's version of it, read-only, through the
 * same `githawk-rev` scheme the diff editor's historical side uses — so
 * blame, syntax highlighting and Reveal In Explorer all work on it already.
 */
export class RevisionFilesTree implements vscode.TreeDataProvider<RevisionNode> {
    private readonly changed = new vscode.EventEmitter<RevisionNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    private revision?: BrowsedRevision;
    private roots: RevisionNode[] = [];
    private parents = new Map<RevisionNode, RevisionNode>();
    /**
     * Part of every folder's id, as in the Changes tree: VS Code remembers a
     * folder's open state by id, so retiring every id is how "expand all"
     * gets every folder to open — and how a new revision starts folded.
     */
    private generation = 0;
    /** Folders open when first drawn. Off for a whole project, on after "expand all". */
    private expanded = false;
    private view?: vscode.TreeView<RevisionNode>;

    attach(view: vscode.TreeView<RevisionNode>): void {
        this.view = view;
        this.describe();
    }

    get current(): BrowsedRevision | undefined {
        return this.revision;
    }

    /** See gitHawk.filesTree: the rows exactly as the view has them. */
    rootsForTesting(): RevisionNode[] {
        return this.roots;
    }

    show(revision: BrowsedRevision): void {
        this.revision = revision;
        this.roots = buildRevisionTree(revision.paths, revision.hash);
        this.parents = parentsOf(this.roots);
        this.generation += 1;
        this.expanded = false;
        this.changed.fire(undefined);
        this.describe();
    }

    clear(): void {
        this.revision = undefined;
        this.roots = [];
        this.parents = new Map();
        this.changed.fire(undefined);
        this.describe();
    }

    expandAll(): void {
        this.generation += 1;
        this.expanded = true;
        this.changed.fire(undefined);
    }

    getParent(element: RevisionNode): RevisionNode | undefined {
        return this.parents.get(element);
    }

    getChildren(element?: RevisionNode): RevisionNode[] {
        if (!element) {
            return this.roots;
        }
        return element.kind === 'file' ? [] : element.children;
    }

    getTreeItem(node: RevisionNode): vscode.TreeItem {
        if (node.kind === 'directory') {
            const item = new vscode.TreeItem(
                node.label,
                this.expanded
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
            );
            item.iconPath = vscode.ThemeIcon.Folder;
            const files = countFiles(node);
            item.description = `${files} ${files === 1 ? 'file' : 'files'}`;
            item.contextValue = 'gitHawkRevisionDirectory';
            item.id = `${this.generation}:${node.path}`;
            return item;
        }

        const item = new vscode.TreeItem(basename(node.path));
        // The revision URI, so the icon theme picks the icon from the
        // extension and the row opens the document it names.
        item.resourceUri = encodeRevisionUri(node.rev, node.path);
        item.tooltip = node.path;
        item.contextValue = 'gitHawkRevisionFile';
        item.command = {
            command: OPEN_FILE_AT_REVISION_COMMAND,
            title: 'Open File At This Commit',
            arguments: [node],
        };
        return item;
    }

    /**
     * The view's own title, description, and message carry the commit's
     * identity, so the tree says what it is showing without a heading row.
     */
    private describe(): void {
        void vscode.commands.executeCommand(
            'setContext',
            REVISION_SHOWN_CONTEXT,
            this.revision !== undefined
        );

        if (!this.view) {
            return;
        }

        if (!this.revision) {
            this.view.title = 'Files';
            this.view.description = undefined;
            this.view.message = undefined;
            this.view.badge = undefined;
            return;
        }

        const { hash, subject, paths } = this.revision;
        const short = hash.slice(0, 8);
        // The hash in the description, not the title: VS Code title-cases a
        // section's title, and a capitalised hash reads as a different hash.
        this.view.title = 'Files';
        this.view.description = subject ? `${short}  ${subject}` : short;
        this.view.message =
            paths.length === 0
                ? 'This commit has no files.'
                : `Every file as it was at ${short}, read-only. Right-click one to compare it with your working tree.`;
        this.view.badge = {
            value: paths.length,
            tooltip: `${paths.length} files at ${hash.slice(0, 8)}`,
        };
    }
}

function parentsOf(roots: RevisionNode[]): Map<RevisionNode, RevisionNode> {
    const parents = new Map<RevisionNode, RevisionNode>();
    const walk = (node: RevisionNode) => {
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
