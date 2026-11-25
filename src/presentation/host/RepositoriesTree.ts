import * as vscode from 'vscode';
import {
    SummarizeRepositoriesUseCase,
    type RepositorySummaryResult,
} from '../../application/usecases/SummarizeRepositoriesUseCase';
import type { IRepositorySummaryReader } from '../../domain/repositories/IRepositorySummaryReader';
import { RepositoryDecorationProvider, repositoryUri } from './RepositoryDecorationProvider';
import type { RepositoryRegistry } from './RepositoryRegistry';
import {
    buildRepositoryRows,
    countChangedRepositories,
    type RepositoryRow,
} from './repositoriesTreeModel';

export const REPOSITORIES_VIEW_ID = 'gitHawkRepositories';
/** Swaps the filter button between its two states. */
export const HIDING_CLEAN_CONTEXT = 'gitHawk.hidingCleanRepositories';
/** Remembered per workspace, like the other choices about what the sidebar shows. */
const HIDE_CLEAN_KEY = 'gitHawk.hideCleanRepositories';

/** What the integration tests read: the rows exactly as VS Code was handed them. */
export interface RepositoryRowForTesting {
    root: string;
    label: string;
    description: string;
    contextValue: string;
    icon: string;
    state: RepositoryRow['state'];
    command?: { command: string; arguments: unknown[] };
}

/**
 * Every repository in the workspace on one line each: its branch, how much is
 * uncommitted, and how far it is from its upstream — so a workspace of many
 * can be read at a glance without selecting each one in turn.
 *
 * Clicking a row selects that repository, which is the same thing the picker
 * does: the graph, the Changes view and the commit box all follow it.
 */
export class RepositoriesTree implements vscode.TreeDataProvider<RepositoryRow>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly summarised = new vscode.EventEmitter<number>();
    /** Fires after every read with the number of repositories holding uncommitted work. */
    readonly onDidSummarise = this.summarised.event;

    readonly decorations = new RepositoryDecorationProvider();

    private results = new Map<string, RepositorySummaryResult>();
    private hideClean: boolean;
    /** Newest wins: a full read finishing after a newer one must not undo it. */
    private generation = 0;

    constructor(
        private readonly repositories: RepositoryRegistry,
        private readonly readerFor: (root: string) => IRepositorySummaryReader,
        private readonly memento: vscode.Memento
    ) {
        this.hideClean = memento.get<boolean>(HIDE_CLEAN_KEY, false);
        void vscode.commands.executeCommand('setContext', HIDING_CLEAN_CONTEXT, this.hideClean);
    }

    get hidesClean(): boolean {
        return this.hideClean;
    }

    get changedCount(): number {
        return countChangedRepositories(this.results.values());
    }

    /** Re-reads every repository, and forgets the ones no longer discovered. */
    async refreshAll(): Promise<void> {
        const roots = this.repositories.all.map((repository) => repository.root);
        const generation = ++this.generation;
        const read = await new SummarizeRepositoriesUseCase(this.readerFor).execute(roots);
        if (generation !== this.generation) {
            return;
        }
        this.results = new Map(read.map((result) => [result.root, result]));
        this.redraw();
    }

    /** Re-reads only these — a save, or a commit, touches one repository. */
    async refresh(roots: readonly string[]): Promise<void> {
        const known = new Set(this.repositories.all.map((repository) => repository.root));
        const wanted = roots.filter((root) => known.has(root));
        if (wanted.length === 0) {
            return;
        }
        const generation = this.generation;
        const read = await new SummarizeRepositoriesUseCase(this.readerFor).execute(wanted);
        // A full read started meanwhile has newer answers for these too.
        if (generation !== this.generation) {
            return;
        }
        for (const result of read) {
            this.results.set(result.root, result);
        }
        this.redraw();
    }

    /** The selected repository moved: only its check mark has to. */
    redraw(): void {
        this.decorations.setRows(this.rows());
        this.changed.fire();
        this.summarised.fire(this.changedCount);
    }

    async setHideClean(hide: boolean): Promise<void> {
        if (hide === this.hideClean) {
            return;
        }
        this.hideClean = hide;
        await vscode.commands.executeCommand('setContext', HIDING_CLEAN_CONTEXT, hide);
        this.redraw();
        try {
            await this.memento.update(HIDE_CLEAN_KEY, hide);
        } catch {
            // Forgetting the filter next time is a nuisance, not a failure.
        }
    }

    getChildren(element?: RepositoryRow): RepositoryRow[] {
        return element ? [] : this.rows();
    }

    getTreeItem(row: RepositoryRow): vscode.TreeItem {
        const item = new vscode.TreeItem(row.name, vscode.TreeItemCollapsibleState.None);
        item.id = row.root;
        item.description = row.description;
        // The decoration's colour is keyed on this, not on the label.
        item.resourceUri = repositoryUri(row.root);
        item.iconPath = new vscode.ThemeIcon(row.active ? 'check' : 'repo');
        item.tooltip = new vscode.MarkdownString(
            row.tooltip.map(escapeMarkdown).join('  \n')
        );
        item.contextValue = contextValueOf(row);
        item.command = {
            command: 'gitHawk.selectRepository',
            title: 'Select Repository',
            arguments: [row.root],
        };
        return item;
    }

    /** See gitHawk.repositoriesTree. */
    rowsForTesting(): RepositoryRowForTesting[] {
        return this.rows().map((row) => {
            const item = this.getTreeItem(row);
            return {
                root: row.root,
                label: String(item.label),
                description: String(item.description),
                contextValue: item.contextValue ?? '',
                icon: (item.iconPath as vscode.ThemeIcon).id,
                state: row.state,
                command: item.command
                    ? { command: item.command.command, arguments: item.command.arguments ?? [] }
                    : undefined,
            };
        });
    }

    private rows(): RepositoryRow[] {
        return buildRepositoryRows(
            this.repositories.all,
            this.results,
            this.repositories.active?.root,
            { hideClean: this.hideClean }
        );
    }

    dispose(): void {
        this.changed.dispose();
        this.summarised.dispose();
        this.decorations.dispose();
    }
}

/**
 * Space-separated flags the row's inline actions match on: Commit only where
 * there is something to commit, Pull only when behind, Push only when ahead.
 */
function contextValueOf(row: RepositoryRow): string {
    const flags = ['gitHawkRepositoryRow'];
    const summary = row.summary;
    if (summary) {
        if (summary.changedFiles > 0) {
            flags.push('changed');
        }
        if (summary.ahead > 0) {
            flags.push('ahead');
        }
        if (summary.behind > 0) {
            flags.push('behind');
        }
    }
    if (row.active) {
        flags.push('selected');
    }
    return flags.join(' ');
}

/** Branch names and paths are the user's text, and `*` or `_` in one is not emphasis. */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');
}
