import * as vscode from 'vscode';
import { FileChangeDto } from '../../application/dto/ComparisonDto';

/**
 * A dedicated scheme for changed-file rows in the tree.
 *
 * Not `file:` — a FileDecorationProvider registered for `file:` would decorate
 * every matching path everywhere in the workbench, including the real explorer.
 * A private scheme keeps the decorations to this tree while VS Code still picks
 * the file icon from the path's extension.
 */
export const CHANGE_SCHEME = 'githawk-change';

export function changeUri(path: string): vscode.Uri {
    return vscode.Uri.from({ scheme: CHANGE_SCHEME, path: `/${path}` });
}

function pathOf(uri: vscode.Uri): string {
    return uri.path.replace(/^\//, '');
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

    private byPath = new Map<string, FileChangeDto>();

    setChanges(changes: FileChangeDto[]): void {
        const affected = [
            ...[...this.byPath.keys()].map(changeUri),
            ...changes.map((change) => changeUri(change.path)),
        ];

        this.byPath = new Map(changes.map((change) => [change.path, change]));
        this.changed.fire(affected);
    }

    clear(): void {
        this.setChanges([]);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== CHANGE_SCHEME) {
            return undefined;
        }

        const change = this.byPath.get(pathOf(uri));
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
    };
    return words[change.status];
}
