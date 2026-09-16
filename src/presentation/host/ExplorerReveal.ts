import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REVISION_SCHEME, decodeRevisionUri } from './RevisionContentProvider';

/**
 * Files GitHawk has opened on the right side of a diff, as fsPaths. The
 * editor-title button reads this through `resourcePath in gitHawk.diffFiles`,
 * so it appears on the diffs GitHawk opened and not on every diff in the
 * workbench. A historical side needs no list: its scheme is GitHawk's own.
 */
export const DIFF_FILES_CONTEXT = 'gitHawk.diffFiles';

/**
 * Finds the working-tree file behind whatever a diff editor is showing, and
 * asks the Explorer to select it.
 *
 * The right side of a GitHawk diff is either the file on disk — a working-tree
 * comparison — or a `githawk-rev` document, which has a path but no location
 * until one is joined to the repository it came from. VS Code's own "Reveal
 * in Explorer View" can do the first and not the second, which is the gap
 * this fills.
 */
export class ExplorerReveal {
    private readonly opened = new Set<string>();

    constructor(private readonly repositoryRoot: () => string | undefined) {}

    /** Called for every diff GitHawk opens, so the button knows where to appear. */
    noteOpened(rightSide: vscode.Uri): void {
        if (rightSide.scheme !== 'file') {
            return;
        }
        this.opened.add(rightSide.fsPath);
        void vscode.commands.executeCommand(
            'setContext',
            DIFF_FILES_CONTEXT,
            [...this.opened]
        );
    }

    /**
     * Reveals the file behind `target`, or behind the active editor when the
     * command came from the palette with nothing selected. Returns the path
     * revealed, so a test can see the resolution without watching the Explorer.
     */
    async reveal(target?: vscode.Uri): Promise<string | undefined> {
        const uri = target ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
            return undefined;
        }

        const fsPath = this.resolve(uri);
        if (fsPath === undefined) {
            vscode.window.setStatusBarMessage(
                'GitHawk: this document is not a file in the repository',
                3000
            );
            return undefined;
        }
        if (!existsSync(fsPath)) {
            // A deleted file, or a file from history that no longer exists.
            vscode.window.setStatusBarMessage(
                `GitHawk: ${uri.path.replace(/^\//, '')} is not in the working tree`,
                4000
            );
            return undefined;
        }

        await vscode.commands.executeCommand(
            'revealInExplorer',
            vscode.Uri.file(fsPath)
        );
        return fsPath;
    }

    /** A path in the repository, for a path git handed us. */
    resolvePath(repositoryRelative: string): string | undefined {
        const root = this.repositoryRoot();
        return root ? join(root, repositoryRelative) : undefined;
    }

    private resolve(uri: vscode.Uri): string | undefined {
        if (uri.scheme === 'file') {
            return uri.fsPath;
        }
        if (uri.scheme === REVISION_SCHEME) {
            return this.resolvePath(decodeRevisionUri(uri).path);
        }
        return undefined;
    }
}
