import * as vscode from 'vscode';
import { basename } from 'node:path';
import { describeProgress, type ReviewController, type ReviewEntry } from './ReviewController';

export const REVIEWS_VIEW_ID = 'gitHawkReviews';
export const REVIEW_ROW_CONTEXT = 'gitHawkReview';

/** A repository heading, when reviews are under way in more than one. */
interface RepositoryRow {
    kind: 'repository';
    root: string;
    entries: ReviewEntry[];
}

type Row = RepositoryRow | (ReviewEntry & { kind: 'review' });

/**
 * Every review in progress, in a view of its own below Changes: a pull
 * request's commits, a colleague's branch, your own uncommitted work. Click
 * one to go back to it; its row sends its comments to an AI CLI or ends it.
 *
 * Flat while every review is in one repository; grouped by repository once
 * they are not, because then "which repository" is the first question.
 */
export class ReviewsTree implements vscode.TreeDataProvider<Row>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<Row | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly subscription: vscode.Disposable;

    constructor(private readonly reviews: ReviewController) {
        this.subscription = reviews.onDidChange(() => this.changed.fire(undefined));
    }

    dispose(): void {
        this.subscription.dispose();
        this.changed.dispose();
    }

    getChildren(row?: Row): Row[] {
        if (row?.kind === 'repository') {
            return row.entries.map((entry) => ({ ...entry, kind: 'review' }));
        }
        if (row) {
            return [];
        }
        const entries = this.reviews.entries();
        const roots = [...new Set(entries.map((entry) => entry.root))];
        if (roots.length <= 1) {
            return entries.map((entry) => ({ ...entry, kind: 'review' }));
        }
        return roots.map((root) => ({
            kind: 'repository',
            root,
            entries: entries.filter((entry) => entry.root === root),
        }));
    }

    getTreeItem(row: Row): vscode.TreeItem {
        if (row.kind === 'repository') {
            const item = new vscode.TreeItem(
                basename(row.root),
                vscode.TreeItemCollapsibleState.Expanded
            );
            item.iconPath = new vscode.ThemeIcon('repo');
            item.description = `${row.entries.length}`;
            item.tooltip = row.root;
            item.id = `repository:${row.root}`;
            return item;
        }

        const { review, onScreen } = row;
        const item = new vscode.TreeItem(review.label);
        item.id = `review:${review.id}`;
        item.description = onScreen
            ? `reviewing · ${describeProgress(review)}`
            : describeProgress(review);
        item.iconPath = new vscode.ThemeIcon(onScreen ? 'eye' : 'checklist');
        item.contextValue = REVIEW_ROW_CONTEXT;
        item.tooltip = new vscode.MarkdownString(
            [
                `**${review.label}**`,
                `Started ${new Date(review.startedAt).toLocaleString()}`,
                describeProgress(review),
                `\`${row.root}\``,
            ].join('\n\n')
        );
        item.command = {
            command: 'gitHawk.review.resume',
            title: 'Open Review',
            arguments: [review.id],
        };
        return item;
    }
}
