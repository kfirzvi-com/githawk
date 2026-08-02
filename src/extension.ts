import * as vscode from 'vscode';
import { realpathSync } from 'node:fs';
import {
    DEFAULT_COMMIT_LIMIT,
    GitCliRepository,
} from './infrastructure/git/GitCliRepository';
import { GitCliComparer } from './infrastructure/git/GitCliComparer';
import { GitCliWorktreeReader } from './infrastructure/git/GitCliWorktreeReader';
import { GitCliRemoteReader } from './infrastructure/git/GitCliRemoteReader';
import { GitCliStashReader } from './infrastructure/git/GitCliStashReader';
import { GitCliWorkingTreeReader } from './infrastructure/git/GitCliWorkingTreeReader';
import { GitCliBlameReader } from './infrastructure/git/GitCliBlameReader';
import { BlameDecorator } from './presentation/host/BlameDecorator';
import { GitCliWriter } from './infrastructure/git/GitCliWriter';
import { ChangeDecorationProvider } from './presentation/host/ChangeDecorationProvider';
import {
    CHANGED_FILES_VIEW_ID,
    ChangedFilesTree,
    OPEN_DIFF_COMMAND,
} from './presentation/host/ChangedFilesTree';
import { ListWorktreesUseCase } from './application/usecases/ListWorktreesUseCase';
import { PerformGitActionUseCase } from './application/usecases/PerformGitActionUseCase';
import { ComparisonController } from './presentation/host/ComparisonController';
import { FileSystemRepositoryLocator } from './infrastructure/fs/FileSystemRepositoryLocator';
import { RepositoryRegistry } from './presentation/host/RepositoryRegistry';
import { RepositoryWatcher } from './presentation/host/RepositoryWatcher';
import { GitCliDirectoryReader } from './infrastructure/git/GitCliDirectoryReader';
import {
    AUTO_REFRESH_SETTING,
    BLAME_STYLE_SETTING,
    CONFIG_SECTION,
    SCAN_DEPTH_SETTING,
} from './presentation/host/config';
import { initialiseLog, log } from './presentation/host/log';
import {
    GITHAWK_VIEW_ID,
    GitGraphViewProvider,
} from './presentation/host/GitGraphViewProvider';
import {
    REVISION_SCHEME,
    RevisionContentProvider,
} from './presentation/host/RevisionContentProvider';

export { CONFIG_SECTION } from './presentation/host/config';

/**
 * Set once at activation. The adapter factories are module-level so they can be
 * shared, and every one of them needs the working directory of whichever
 * repository is currently selected.
 */
let repositoryRegistry: RepositoryRegistry | undefined;

function activeRepositoryRoot(): string {
    if (!repositoryRegistry) {
        throw new Error('GitHawk is not activated yet.');
    }
    return repositoryRegistry.rootOrThrow();
}

/**
 * Composition root: the only place that picks concrete adapters.
 *
 * Async so that the repository scan has finished before activation resolves.
 * Every disposable is registered before the first `await`, so commands exist
 * immediately regardless of how long the scan takes.
 */
export async function activate(
    context: vscode.ExtensionContext
): Promise<void> {
    context.subscriptions.push(initialiseLog());
    log.info('GitHawk activated');

    const repositories = new RepositoryRegistry(
        context.workspaceState,
        () => new FileSystemRepositoryLocator(),
        // Git reports resolved paths, the workspace does not; without this,
        // showing a worktree in GitHawk silently fails wherever /tmp is a
        // symlink for /private/tmp, which is to say on every Mac.
        (path) => realpathSync.native(path)
    );
    repositoryRegistry = repositories;
    context.subscriptions.push(repositories);

    const comparisons = new ComparisonController(
        createGitComparer,
        createGitRepository,
        activeRepositoryRoot
    );

    const decorations = new ChangeDecorationProvider();
    const changedFiles = new ChangedFilesTree(decorations);
    const changesView = vscode.window.createTreeView(CHANGED_FILES_VIEW_ID, {
        treeDataProvider: changedFiles,
        showCollapseAll: true,
    });
    changedFiles.attach(changesView);

    const watcher = new RepositoryWatcher(
        (root) => new GitCliDirectoryReader(root)
    );
    context.subscriptions.push(watcher);

    const blame = new BlameDecorator(
        (root) => new GitCliBlameReader(root),
        () => repositories.active?.root
    );
    context.subscriptions.push(blame);

    const provider = new GitGraphViewProvider(
        context.extensionUri,
        createGitRepository,
        createGitWriter,
        comparisons,
        changedFiles,
        repositories,
        createWorktreeReader,
        createRemoteReader,
        createStashReader,
        createWorkingTreeReader
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
        vscode.window.registerFileDecorationProvider(decorations),
        // Refreshing rescans as well as reloads: a repository cloned since the
        // window opened is exactly what someone pressing refresh is after. The
        // registry's change event reloads the graph.
        vscode.commands.registerCommand('gitHawk.refresh', () =>
            repositories.refresh()
        ),
        repositories.onDidChange(() => {
            provider.refresh();
            // The scan may have chosen a different repository, and the watcher
            // is only ever pointed at one.
            void watcher.watch(repositories.active?.root);
        }),
        // A reload, not a rescan: the repository moved, the set of them did not.
        watcher.onDidChange(() => provider.refresh()),
        /*
         * With no argument this shows the picker. With one it switches directly,
         * which makes the command usable from a keybinding or a task — and is how
         * the integration tests drive it.
         */
        vscode.commands.registerCommand(
            'gitHawk.selectRepository',
            (root?: string) => {
                if (typeof root === 'string') {
                    repositories.setActive(root);
                    return;
                }
                return repositories.pick();
            }
        ),
        vscode.commands.registerCommand('gitHawk.manageWorktrees', () =>
            provider.createWorktreeMenu().showManager()
        ),
        vscode.commands.registerCommand('gitHawk.manageRemotes', () =>
            provider.createRemoteMenu().showManager()
        ),
        vscode.commands.registerCommand('gitHawk.manageStashes', () =>
            provider.createStashMenu().showManager()
        ),
        // Reports the stash as the extension sees it.
        vscode.commands.registerCommand('gitHawk.stashes', () =>
            provider.createStashMenu().managerItemsForTesting()
        ),
        // Reports the remotes as the extension sees them.
        vscode.commands.registerCommand('gitHawk.remotes', () =>
            provider.createRemoteMenu().managerItemsForTesting()
        ),
        vscode.commands.registerCommand('gitHawk.startAiTool', () =>
            provider.createWorktreeMenu().startAiToolHere()
        ),
        // Returns the picker's structure without showing it, so the integration
        // tests can assert what it offers.
        vscode.commands.registerCommand('gitHawk.repositoryPickItems', () =>
            repositories.pickItemsForTesting()
        ),
        vscode.commands.registerCommand('gitHawk.worktreeItems', () =>
            provider.createWorktreeMenu().managerItemsForTesting()
        ),
        // Reports the worktrees as the extension sees them.
        vscode.commands.registerCommand('gitHawk.worktrees', async () =>
            (
                await new ListWorktreesUseCase(createWorktreeReader()).execute()
            ).map((worktree) => ({
                path: worktree.path,
                name: worktree.name,
                branch: worktree.branch,
                isMain: worktree.isMain,
                isCurrent: worktree.isCurrent,
                isLocked: worktree.isLocked,
                isPrunable: worktree.isPrunable,
                checkedOut: worktree.checkedOut,
            }))
        ),
        // Reports what the scan found, so the integration tests can assert on
        // real state rather than on a screenshot.
        vscode.commands.registerCommand('gitHawk.repositories', () => ({
            repositories: repositories.all.map((repository) => ({
                ...repository,
            })),
            activeRoot: repositories.active?.root,
        })),
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
        // What the webview was last sent, so the integration tests can watch
        // for a reload rather than sleep and hope.
        vscode.commands.registerCommand('gitHawk.graphSnapshot', () =>
            provider.graphSnapshotForTesting()
        ),
        // Reachable without the panel open, so a keybinding can go straight
        // from editing to reviewing what has been edited.
        vscode.commands.registerCommand('gitHawk.showUncommittedChanges', () =>
            provider.compareWorkingTree()
        ),
        // How many times the Changes view has been surfaced, so a test can
        // tell "revealed again" from "filled again".
        vscode.commands.registerCommand('gitHawk.changesRevealed', () =>
            provider.revealsForTesting()
        ),
        // Reports the working tree as the extension sees it.
        vscode.commands.registerCommand('gitHawk.workingTree', () =>
            provider.workingTreeForTesting()
        ),
        /*
         * The link out of a blame hover. Selecting the commit also fills the
         * Changes tree, which is the same thing clicking it in the graph does —
         * so arriving from the editor and arriving from the graph leave you in
         * the same place.
         */
        vscode.commands.registerCommand('gitHawk.revealCommit', (hash: string) =>
            provider.revealCommit(hash)
        ),
        vscode.commands.registerCommand('gitHawk.showLog', () => log.show()),
        // Returns a branch menu's structure without showing it, so the
        // integration tests can assert the grouping.
        vscode.commands.registerCommand(
            'gitHawk.branchMenuEntries',
            (name: string, isRemote = false) =>
                provider.branchMenuEntriesForTesting(name, isRemote)
        ),
        vscode.commands.registerCommand(
            'gitHawk.commitMenuEntries',
            (hash: string) => provider.commitMenuEntriesForTesting(hash)
        ),
        vscode.commands.registerCommand('gitHawk.updateAllBranches', () =>
            updateAllBranches(provider)
        ),
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
        // Blame belongs to a file, so it is redrawn when the file being looked
        // at changes, when its content changes, and when the repository moves
        // underneath it.
        vscode.window.onDidChangeActiveTextEditor((editor) =>
            blame.decorate(editor)
        ),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (
                document === vscode.window.activeTextEditor?.document
            ) {
                void blame.decorate(vscode.window.activeTextEditor);
            }
        }),
        // A new folder changes which repositories exist, so it needs a rescan
        // rather than a reload.
        vscode.workspace.onDidChangeWorkspaceFolders(() =>
            repositories.refresh()
        ),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (
                event.affectsConfiguration(
                    `${CONFIG_SECTION}.${SCAN_DEPTH_SETTING}`
                )
            ) {
                void repositories.refresh();
            } else if (
                event.affectsConfiguration(
                    `${CONFIG_SECTION}.${BLAME_STYLE_SETTING}`
                )
            ) {
                void blame.decorate(vscode.window.activeTextEditor);
            } else if (
                event.affectsConfiguration(
                    `${CONFIG_SECTION}.${AUTO_REFRESH_SETTING}`
                )
            ) {
                // Re-reads the setting: installs the watchers, or removes them.
                void watcher.watch(repositories.active?.root);
            } else if (event.affectsConfiguration(CONFIG_SECTION)) {
                provider.refresh();
            }
        })
    );

    // Everything above is registered; the graph can now wait for the scan that
    // tells it which repository to read.
    await repositories.refresh();
    // A file is usually already open when the extension activates.
    void blame.decorate(vscode.window.activeTextEditor);
}

/**
 * Resolved per load rather than once at activation, so switching repository,
 * opening a folder, or changing the commit limit takes effect without a window
 * reload.
 */
function createGitRepository(): GitCliRepository {
    const limit = vscode.workspace
        .getConfiguration(CONFIG_SECTION)
        .get<number>('commitLimit', DEFAULT_COMMIT_LIMIT);

    return new GitCliRepository({ cwd: activeRepositoryRoot(), limit });
}

function createGitWriter(): GitCliWriter {
    return new GitCliWriter(activeRepositoryRoot());
}

function createGitComparer(): GitCliComparer {
    return new GitCliComparer(activeRepositoryRoot());
}

function createWorktreeReader(): GitCliWorktreeReader {
    return new GitCliWorktreeReader(activeRepositoryRoot());
}

function createRemoteReader(): GitCliRemoteReader {
    return new GitCliRemoteReader(activeRepositoryRoot());
}

function createStashReader(): GitCliStashReader {
    return new GitCliStashReader(activeRepositoryRoot());
}

function createWorkingTreeReader(): GitCliWorkingTreeReader {
    return new GitCliWorkingTreeReader(activeRepositoryRoot());
}

/**
 * Fast-forwards every local branch that is purely behind its upstream, without
 * checking any of them out.
 *
 * Deliberately skips diverged branches: advancing one needs a merge or rebase,
 * which is a decision rather than a chore, and doing it silently across several
 * branches is how people lose work.
 */
async function updateAllBranches(
    provider: GitGraphViewProvider
): Promise<void> {
    const repository = await createGitRepository().getRepository();
    const updatable = repository.localBranches.filter(
        (branch) => branch.canFastForwardToUpstream && !branch.isCurrent
    );
    const diverged = repository.localBranches.filter(
        (branch) => branch.hasDiverged
    );

    if (updatable.length === 0) {
        vscode.window.showInformationMessage(
            diverged.length > 0
                ? `Nothing to fast-forward. ${diverged.length} branch(es) have diverged and need a merge or rebase.`
                : 'Every branch is already up to date with its upstream.'
        );
        return;
    }

    const writer = createGitWriter();
    const performAction = new PerformGitActionUseCase(writer);
    const failures: string[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Updating branches from their upstreams…',
        },
        async (progress) => {
            for (const branch of updatable) {
                progress.report({ message: branch.name });
                const upstream = branch.upstream!.name;
                const slash = upstream.indexOf('/');
                const outcome = await performAction.execute({
                    type: 'updateBranchFromUpstream',
                    branch: branch.name,
                    remote: slash >= 0 ? upstream.slice(0, slash) : 'origin',
                    remoteBranch:
                        slash >= 0 ? upstream.slice(slash + 1) : upstream,
                });
                if (!outcome.succeeded) {
                    failures.push(`${branch.name}: ${outcome.message ?? 'failed'}`);
                }
            }
        }
    );

    provider.refresh();

    const updated = updatable.length - failures.length;
    if (failures.length === 0) {
        vscode.window.showInformationMessage(
            `Fast-forwarded ${updated} branch(es).`
        );
        return;
    }

    log.warn(`some branches could not be updated: ${failures.join('; ')}`);
    vscode.window.showWarningMessage(
        `Updated ${updated} of ${updatable.length} branches.`,
        'Show log'
    ).then((choice) => {
        if (choice === 'Show log') {
            log.show();
        }
    });
}

export function deactivate(): void {
    // Every disposable is registered on the context; only the module-level
    // handle needs clearing, so a reactivation cannot see a disposed registry.
    repositoryRegistry = undefined;
}
