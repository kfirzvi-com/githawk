import * as vscode from 'vscode';
import {
    DEFAULT_COMMIT_LIMIT,
    GitCliRepository,
} from './infrastructure/git/GitCliRepository';
import { GitCliComparer } from './infrastructure/git/GitCliComparer';
import { GitCliWriter } from './infrastructure/git/GitCliWriter';
import { ComparisonController } from './presentation/host/ComparisonController';
import {
    GITHAWK_VIEW_ID,
    GitGraphViewProvider,
} from './presentation/host/GitGraphViewProvider';
import {
    REVISION_SCHEME,
    RevisionContentProvider,
} from './presentation/host/RevisionContentProvider';

export const CONFIG_SECTION = 'gitHawk';

export class NoWorkspaceFolderError extends Error {
    constructor() {
        super('Open a folder to see its git graph.');
        this.name = 'NoWorkspaceFolderError';
    }
}

/**
 * Composition root: the only place that picks concrete adapters.
 */
export function activate(context: vscode.ExtensionContext): void {
    const comparisons = new ComparisonController(
        createGitComparer,
        createGitRepository,
        firstWorkspaceFolder
    );

    const provider = new GitGraphViewProvider(
        context.extensionUri,
        createGitRepository,
        createGitWriter,
        comparisons
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GITHAWK_VIEW_ID, provider, {
            // Keep the graph alive while the panel is hidden; rebuilding it on
            // every tab switch is the difference between instant and sluggish.
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.commands.registerCommand('gitHawk.open', () =>
            vscode.commands.executeCommand(
                'workbench.view.extension.gitHawkPanel'
            )
        ),
        vscode.commands.registerCommand('gitHawk.refresh', () =>
            provider.refresh()
        ),
        // Serves file contents at a revision so vscode.diff can compare two
        // historical versions, not just files on disk.
        vscode.workspace.registerTextDocumentContentProvider(
            REVISION_SCHEME,
            new RevisionContentProvider(createGitComparer)
        ),
        // A new folder or a changed limit both invalidate what is on screen.
        vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(CONFIG_SECTION)) {
                provider.refresh();
            }
        })
    );
}

/**
 * Resolved per load rather than once at activation, so opening a folder or
 * changing the commit limit takes effect without a window reload.
 */
function createGitRepository(): GitCliRepository {
    const folder = firstWorkspaceFolder();
    const limit = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<number>('commitLimit', DEFAULT_COMMIT_LIMIT);

    return new GitCliRepository({ cwd: folder, limit });
}

function createGitWriter(): GitCliWriter {
    return new GitCliWriter(firstWorkspaceFolder());
}

function createGitComparer(): GitCliComparer {
    return new GitCliComparer(firstWorkspaceFolder());
}

function firstWorkspaceFolder(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new NoWorkspaceFolderError();
    }

    // Multi-root workspaces show the first folder's repository. A repository
    // picker is separate work.
    return folders[0].uri.fsPath;
}

export function deactivate(): void {
    // Nothing to tear down: every disposable is registered on the context.
}
