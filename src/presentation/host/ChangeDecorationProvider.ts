import * as vscode from 'vscode';
import { FileChangeDto } from '../../application/dto/ComparisonDto';
import type { ChangeGroupKind } from '../../domain/models/Comparison';

/**
 * A dedicated scheme for changed-file rows in the tree.
 *
 * Not `file:` — a FileDecorationProvider registered for `file:` would decorate
 * every matching path everywhere in the workbench, including the real explorer.
 * A private scheme keeps the decorations to this tree while VS Code still picks
 * the file icon from the path's extension.
 */
export const CHANGE_SCHEME = 'githawk-change';

/**
 * The group rides in the query. A file that is both staged and edited again
 * is two rows with one path, and each has to be badged for its own state —
 * keyed on the path alone, the second would repaint the first.
 */
export function changeUri(path: string, group?: ChangeGroupKind): vscode.Uri {
    return vscode.Uri.from({
        scheme: CHANGE_SCHEME,
        path: `/${path}`,
        query: group ?? '',
    });
}

function keyOf(uri: vscode.Uri): string {
    return `${uri.query}:${uri.path.replace(/^\//, '')}`;
}

export interface DecoratedChange {
    change: FileChangeDto;
    group?: ChangeGroupKind;
}

/**
 * Gives each row the letter badge and colour VS Code uses for git status, so the
 * tree reads like the Source Control view instead of a plain list.
 *
 * The colours are theme tokens rather than literals, so they follow the user's
 * theme and stay legible in light and dark alike.
 */
export class ChangeDecorationProvider
    implements vscode.FileDecorationProvider
{
    private readonly changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this.changed.event;

    private byKey = new Map<string, FileChangeDto>();

    setChanges(changes: DecoratedChange[]): void {
        const next = new Map(
            changes.map(({ change, group }) => [
                keyOf(changeUri(change.path, group)),
                change,
            ])
        );
        const affected = [...this.byKey.keys(), ...next.keys()].map((key) => {
            const separator = key.indexOf(':');
            return changeUri(
                key.slice(separator + 1),
                (key.slice(0, separator) || undefined) as
                    | ChangeGroupKind
                    | undefined
            );
        });

        this.byKey = next;
        this.changed.fire(affected);
    }

    clear(): void {
        this.setChanges([]);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== CHANGE_SCHEME) {
            return undefined;
        }

        const change = this.byKey.get(keyOf(uri));
        if (!change) {
            return undefined;
        }

        return {
            badge: badgeFor(change),
            color: colourFor(change),
            tooltip: tooltipFor(change),
            // Deleted files are struck through, matching how VS Code shows them.
            propagate: false,
        };
    }
}

/** The same letters the Source Control view uses, so nothing has to be learned twice. */
function badgeFor(change: FileChangeDto): string {
    switch (change.status) {
        case 'added':
            return 'A';
        case 'deleted':
            return 'D';
        case 'renamed':
            return 'R';
        case 'copied':
            return 'C';
        case 'typeChanged':
            return 'T';
        case 'untracked':
            return 'U';
        case 'conflicted':
            return '!';
        default:
            return 'M';
    }
}

/** Reuses git's own decoration colours so the tree matches Source Control. */
function colourFor(change: FileChangeDto): vscode.ThemeColor {
    switch (change.status) {
        case 'added':
        case 'copied':
            return new vscode.ThemeColor('gitDecoration.addedResourceForeground');
        case 'deleted':
            return new vscode.ThemeColor(
                'gitDecoration.deletedResourceForeground'
            );
        case 'renamed':
            return new vscode.ThemeColor(
                'gitDecoration.renamedResourceForeground'
            );
        case 'untracked':
            return new vscode.ThemeColor(
                'gitDecoration.untrackedResourceForeground'
            );
        case 'conflicted':
            return new vscode.ThemeColor(
                'gitDecoration.conflictingResourceForeground'
            );
        default:
            return new vscode.ThemeColor(
                'gitDecoration.modifiedResourceForeground'
            );
    }
}

function tooltipFor(change: FileChangeDto): string {
    const words: Record<FileChangeDto['status'], string> = {
        added: 'Added',
        deleted: 'Deleted',
        renamed: 'Renamed',
        copied: 'Copied',
        typeChanged: 'Type changed',
        modified: 'Modified',
        untracked: 'Untracked',
        conflicted: 'Conflicted',
    };
    return words[change.status];
}
