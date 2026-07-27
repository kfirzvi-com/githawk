import * as vscode from 'vscode';
import {
    DEFAULT_COMMIT_LIMIT,
    GitCliRepository,
} from './infrastructure/git/GitCliRepository';
import { GitCliComparer } from './infrastructure/git/GitCliComparer';
import { GitCliWriter } from './infrastructure/git/GitCliWriter';
import {
    CHANGED_FILES_VIEW_ID,
    ChangedFilesTree,
    OPEN_DIFF_COMMAND,
} from './presentation/host/ChangedFilesTree';
import { ComparisonController } from './presentation/host/ComparisonController';
import { initialiseLog, log } from './presentation/host/log';
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
    context.subscriptions.push(initialiseLog());
    log.info('GitHawk activated');

    const comparisons = new ComparisonController(
        createGitComparer,
        createGitRepository,
        firstWorkspaceFolder
    );

    const changedFiles = new ChangedFilesTree();
    const changesView = vscode.window.createTreeView(CHANGED_FILES_VIEW_ID, {
        treeDataProvider: changedFiles,
        showCollapseAll: true,
    });
    changedFiles.attach(changesView);

    const provider = new GitGraphViewProvider(
        context.extensionUri,
        createGitRepository,
        createGitWriter,
        comparisons,
        changedFiles
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
        changesView,
        vscode.commands.registerCommand('gitHawk.refresh', () =>
            provider.refresh()
        ),
        // Clicking a file in the Changes tree opens the native diff editor.
        vscode.commands.registerCommand(OPEN_DIFF_COMMAND, (change) => {
            const comparison = changedFiles.current;
            if (!comparison || !change) {
                return;
            }
            void comparisons
                .openFile({
                    path: change.path,
                    previousPath: change.previousPath,
                    baseRev: comparison.baseRev,
                    targetRev: comparison.targetRev,
                })
                .catch((error: unknown) =>
                    vscode.window.showErrorMessage(
                        error instanceof Error ? error.message : String(error)
                    )
                );
        }),
        vscode.commands.registerCommand('gitHawk.clearChanges', () =>
            changedFiles.clear()
        ),
        // Scriptable comparison: usable from a keybinding or automation, and the
        // hook the integration tests drive.
        vscode.commands.registerCommand(
            'gitHawk.compareCommits',
            (hashes: string[]) => provider.compareCommitsForTesting(hashes ?? [])
        ),
        vscode.commands.registerCommand('gitHawk.showLog', () => log.show()),
        // Returns the comparison currently in the Changes view. Lets the
        // integration tests assert on real state instead of scraping logs.
        vscode.commands.registerCommand('gitHawk.lastComparison', () => {
            const current = changedFiles.current;
            return current
                ? {
                      label: current.label,
                      method: current.method,
                      files: current.files.map((f) => f.path),
                      skipped: current.skipped,
                  }
                : undefined;
        }),
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
