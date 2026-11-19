import * as vscode from 'vscode';
import type { RepositoryRow, RepositoryRowState } from './repositoriesTreeModel';

/**
 * Private, for the reason ChangeDecorationProvider gives: a provider for
 * `file:` would colour the repository's folder everywhere in the workbench.
 */
export const REPOSITORY_SCHEME = 'githawk-repository';

export function repositoryUri(root: string): vscode.Uri {
    return vscode.Uri.from({ scheme: REPOSITORY_SCHEME, path: root });
}

/**
 * Colours each row of the Repositories view by what is in it: git's own
 * modified and conflict colours for work to look at, and the colour VS Code
 * gives ignored files for a repository with nothing to say — so the eye goes
 * to the rows that need it.
 *
 * A decoration because a TreeItem has no colour of its own; this is the one
 * way a tree's label is tinted.
 */
export class RepositoryDecorationProvider implements vscode.FileDecorationProvider {
    private readonly changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this.changed.event;

    private states = new Map<string, RepositoryRowState>();

    setRows(rows: readonly RepositoryRow[]): void {
        const next = new Map(rows.map((row) => [row.root, row.state]));
        const affected = [...new Set([...this.states.keys(), ...next.keys()])]
            .filter((root) => this.states.get(root) !== next.get(root))
            .map(repositoryUri);

        this.states = next;
        if (affected.length > 0) {
            this.changed.fire(affected);
        }
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== REPOSITORY_SCHEME) {
            return undefined;
        }
        const color = colourFor(this.states.get(uri.path));
        return color ? { color, propagate: false } : undefined;
    }

    dispose(): void {
        this.changed.dispose();
    }
}

function colourFor(state: RepositoryRowState | undefined): vscode.ThemeColor | undefined {
    switch (state) {
        case 'changed':
            return new vscode.ThemeColor('gitDecoration.modifiedResourceForeground');
        case 'conflicted':
            return new vscode.ThemeColor('gitDecoration.conflictingResourceForeground');
        case 'clean':
            return new vscode.ThemeColor('gitDecoration.ignoredResourceForeground');
        case 'unreadable':
            return new vscode.ThemeColor('errorForeground');
        default:
            return undefined;
    }
}
