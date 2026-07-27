import * as vscode from 'vscode';
import { ComparisonDto } from '../../application/dto/ComparisonDto';
import {
    TreeNode,
    basename,
    buildTree,
    describeChange,
    tooltipFor,
} from './changedFilesTreeModel';

export const CHANGED_FILES_VIEW_ID = 'gitHawkChanges';
export const OPEN_DIFF_COMMAND = 'gitHawk.openChangedFile';

/**
 * Shows the changed files of the current comparison as a folder tree in the
 * primary sidebar.
 *
 * A native TreeView rather than a list inside the webview: it inherits the file
 * icon theme, keyboard navigation, collapse-all, and search, none of which would
 * be worth rebuilding. The shaping logic lives in changedFilesTreeModel so it can
 * be tested without VS Code.
 */
export class ChangedFilesTree implements vscode.TreeDataProvider<TreeNode> {
    private readonly changed = new vscode.EventEmitter<TreeNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    private comparison?: ComparisonDto;
    private roots: TreeNode[] = [];
    private view?: vscode.TreeView<TreeNode>;

    attach(view: vscode.TreeView<TreeNode>): void {
        this.view = view;
        this.describe();
    }

    get current(): ComparisonDto | undefined {
        return this.comparison;
    }

    show(comparison: ComparisonDto): void {
        this.comparison = comparison;
        this.roots = buildTree(comparison.files);
        this.changed.fire(undefined);
        this.describe();
    }

    clear(): void {
        this.comparison = undefined;
        this.roots = [];
        this.changed.fire(undefined);
        this.describe();
    }

    getChildren(element?: TreeNode): TreeNode[] {
        if (!element) {
            return this.roots;
        }
        return element.kind === 'directory' ? element.children : [];
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        if (node.kind === 'directory') {
            const item = new vscode.TreeItem(
                node.label,
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.resourceUri = vscode.Uri.file(node.path);
            item.contextValue = 'gitHawkDirectory';
            return item;
        }

        const { change } = node;
        const item = new vscode.TreeItem(basename(change.path));

        // A file: URI is what makes VS Code apply the icon theme, even though the
        // file need not exist on disk at this revision.
        item.resourceUri = vscode.Uri.file(change.path);
        item.description = describeChange(change);
        item.tooltip = tooltipFor(change);
        item.contextValue = 'gitHawkChangedFile';
        item.command = {
            command: OPEN_DIFF_COMMAND,
            title: 'Open Changes',
            arguments: [change],
        };
        return item;
    }

    /**
     * The view's own title, description, and message carry the comparison's
     * context, so it sits next to the files it describes instead of being
     * duplicated in the webview.
     */
    private describe(): void {
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
