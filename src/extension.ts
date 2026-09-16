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
import { Debouncer } from './presentation/host/debounce';
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
    toggleBlame,
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
import { CommitController } from './presentation/host/CommitController';
import { ExplorerReveal } from './presentation/host/ExplorerReveal';
import {
    COMMIT_VIEW_ID,
    CommitViewProvider,
} from './presentation/host/CommitViewProvider';
import { ShellCommandRunner } from './infrastructure/shell/ShellCommandRunner';
import {
    filesBeneath,
    type FileNode,
    type TreeNode,
} from './presentation/host/changedFilesTreeModel';

export { CONFIG_SECTION } from './presentation/host/config';

/**
 * Long enough that a burst of typing is one redraw, short enough that pausing
 * to read gets the annotations back. Capped so a long stretch of steady typing
 * still refreshes rather than waiting for silence that never comes.
 */
const BLAME_REDRAW_MS = 600;
const BLAME_REDRAW_MAX_MS = 4_000;

/**
 * A save is one keystroke; a "save all" is a burst. One re-read of the
 * working tree per burst is plenty, and the tree it feeds is on screen, so it
 * should not lag a whole second behind either.
 */
const WORKING_TREE_REFRESH_MS = 300;

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

    const explorer = new ExplorerReveal(() => repositories.active?.root);
    const comparisons = new ComparisonController(
        createGitComparer,
        createGitRepository,
        activeRepositoryRoot,
        (rightSide) => explorer.noteOpened(rightSide)
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
        /*
         * The repository the *file* is in, falling back to the selected one.
         *
         * A workspace can hold several repositories and the file on screen is
         * often not in the one the graph is pointed at — asking git from the
         * wrong working directory just fails, so the annotations never
         * appeared. The fallback covers a document with no path of its own,
         * which is what the historical side of a diff is.
         */
        (filePath) =>
            (filePath !== undefined
                ? repositories.containing(filePath)?.root
                : undefined) ?? repositories.active?.root
    );
    context.subscriptions.push(blame);

    const redrawBlame = new Debouncer(
        () => void blame.decorateVisible(),
        BLAME_REDRAW_MS,
        BLAME_REDRAW_MAX_MS
    );
    context.subscriptions.push({ dispose: () => redrawBlame.cancel() });

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

    /*
     * The commit side of the Changes view. The shell is the user's default,
     * which is what "runs like the terminal" has to mean for a command they
     * typed into settings — see ShellCommandRunner for why this one spawn is
     * a shell when every git call is not.
     */
    const commits = new CommitController({
        createWriter: createGitWriter,
        createWorkingTreeReader,
        commandRunner: new ShellCommandRunner(vscode.env.shell || undefined),
        repositoryRoot: activeRepositoryRoot,
        onCompleted: () => provider.refresh(),
    });
    const commitView = new CommitViewProvider(
        context.extensionUri,
        context.globalState,
        commits
    );

    const refreshWorkingTree = new Debouncer(
        () => void provider.refreshWorkingTree(),
        WORKING_TREE_REFRESH_MS,
        WORKING_TREE_REFRESH_MS * 4
    );
    context.subscriptions.push({ dispose: () => refreshWorkingTree.cancel() });

    /** A file event under the active repository is a change to its working tree. */
    const touchesActiveRepository = (uris: readonly vscode.Uri[]) => {
        const root = repositories.active?.root;
        return (
            root !== undefined &&
            uris.some(
                (uri) =>
                    uri.scheme === 'file' &&
                    repositories.containing(uri.fsPath)?.root === root
            )
        );
    };

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GITHAWK_VIEW_ID, provider, {
            // Keep the graph alive while the panel is hidden; rebuilding it on
            // every tab switch is the difference between instant and sluggish.
            webviewOptions: { retainContextWhenHidden: true },
        }),
        vscode.window.registerWebviewViewProvider(COMMIT_VIEW_ID, commitView, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
        // The counts the graph's row shows are the counts the box commits.
        provider.onDidReadWorkingTree((status) => commitView.setStatus(status)),
        /*
         * Stage, unstage, and commit, from the rows of the Changes tree. A
         * directory or a section stages everything beneath it, which is what
         * clicking the + on a folder has to mean.
         */
        vscode.commands.registerCommand('gitHawk.stage', (node?: TreeNode) =>
            commits.stage(pathsBeneath(node))
        ),
        vscode.commands.registerCommand('gitHawk.unstage', (node?: TreeNode) =>
            commits.unstage(pathsBeneath(node))
        ),
        vscode.commands.registerCommand('gitHawk.stageAll', () =>
            commits.stageAll()
        ),
        // The box, brought to the front with the working tree in the tree
        // above it — reachable from the palette and a keybinding.
        vscode.commands.registerCommand('gitHawk.commit', async () => {
            await provider.compareWorkingTree('focus');
            await commitView.focus();
        }),
        vscode.commands.registerCommand(
            'gitHawk.generateCommitMessage',
            async () => {
                await provider.compareWorkingTree('focus');
                await commitView.generateFromCommand();
            }
        ),
        // A save changes what is uncommitted; so does creating, deleting or
        // renaming a file through the explorer. The graph's watcher deliberately
        // ignores the working tree, so this is where it is kept current.
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (touchesActiveRepository([document.uri])) {
                refreshWorkingTree.schedule();
            }
        }),
        vscode.workspace.onDidCreateFiles((event) => {
            if (touchesActiveRepository(event.files)) {
                refreshWorkingTree.schedule();
            }
        }),
        vscode.workspace.onDidDeleteFiles((event) => {
            if (touchesActiveRepository(event.files)) {
                refreshWorkingTree.schedule();
            }
        }),
        vscode.workspace.onDidRenameFiles((event) => {
            if (touchesActiveRepository(event.files.map((file) => file.newUri))) {
                refreshWorkingTree.schedule();
            }
        }),
        vscode.commands.registerCommand('gitHawk.open', () =>
            vscode.commands.executeCommand(
                'workbench.view.extension.gitHawkPanel'
            )
        ),
        /*
         * The other half of Cmd+9. The key opens the graph; pressed again with
         * the graph focused it hides the whole bottom panel, so one key both
         * summons and dismisses it. The keybinding in package.json routes the
         * second press straight to the workbench's closePanel — this command
         * exists so the palette offers the same thing by name.
         */
        vscode.commands.registerCommand('gitHawk.closePanel', () =>
            vscode.commands.executeCommand('workbench.action.closePanel')
        ),
        // The sidebar, with the keyboard on the Changes tree: Cmd+Shift+9,
        // the panel's key with Shift, so the two are one thing to remember.
        vscode.commands.registerCommand('gitHawk.openSidebar', () =>
            vscode.commands.executeCommand(`${CHANGED_FILES_VIEW_ID}.focus`)
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
        /*
         * Clicking a file in the Changes tree opens the native diff editor.
         * The row carries its own two revisions: in the working tree a staged
         * file is HEAD against the index and an unstaged one the index
         * against the disk, and a single pair for the whole tree would open
         * the wrong diff for one of them.
         */
        vscode.commands.registerCommand(OPEN_DIFF_COMMAND, (node?: FileNode) => {
            if (!changedFiles.current || !node) {
                return;
            }
            void comparisons
                .openFile({
                    path: node.change.path,
                    previousPath: node.change.previousPath,
                    baseRev: node.baseRev,
                    targetRev: node.targetRev,
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
        /*
         * From a diff GitHawk opened to the file in the Explorer. The title
         * bar passes the editor's resource; the palette passes nothing and
         * the active editor is used. Returns the path it revealed, for the
         * integration tests.
         */
        vscode.commands.registerCommand(
            'gitHawk.revealInExplorer',
            (resource?: vscode.Uri) =>
                explorer.reveal(resource instanceof vscode.Uri ? resource : undefined)
        ),
        // The same, from a row of the Changes tree.
        vscode.commands.registerCommand(
            'gitHawk.revealChangedFileInExplorer',
            (node?: TreeNode) => {
                const path =
                    node?.kind === 'file'
                        ? explorer.resolvePath(node.change.path)
                        : undefined;
                return path ? explorer.reveal(vscode.Uri.file(path)) : undefined;
            }
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
        vscode.commands.registerCommand(
            'gitHawk.revealCommit',
            (hash: string, fromPath?: string) =>
                provider.revealCommit(hash, fromPath)
        ),
        /*
         * The same thing from the keyboard, for the line the caret is on. Blame
         * is read whatever the style setting says: turning the column on to ask
         * one question and off again is the work this saves.
         */
        vscode.commands.registerCommand('gitHawk.revealCommitForLine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }

            const found = await blame.blockFor(
                editor.document,
                editor.selection.active.line
            );
            if (!found) {
                vscode.window.setStatusBarMessage(
                    'GitHawk: nothing to blame on this line',
                    3000
                );
                return;
            }
            if (found.block.commit.isUncommitted) {
                vscode.window.setStatusBarMessage(
                    'GitHawk: this line is not committed yet',
                    3000
                );
                return;
            }

            await provider.revealCommit(found.block.commit.hash, found.path);
        }),
        // The branch list as a picker, in the palette as well as on Shift+T.
        vscode.commands.registerCommand('gitHawk.switchBranch', () =>
            provider.pickBranch()
        ),
        // The hover card the mouse gets, at the caret.
        vscode.commands.registerCommand('gitHawk.blameLine', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            if (!(await blame.showLineHover(editor))) {
                vscode.window.setStatusBarMessage(
                    'GitHawk: nothing to blame on this line',
                    3000
                );
            }
        }),
        /*
         * The way blame is turned on and off. A setting alone is not a way in:
         * it cannot be found without already knowing its name, and this is a
         * thing people flick on to answer one question and off again.
         *
         * Off is the default, so the first toggle picks the column; after that
         * it returns to whichever placement was last on.
         */
        vscode.commands.registerCommand('gitHawk.toggleBlame', async () => {
            const style = await toggleBlame();
            vscode.window.setStatusBarMessage(
                style === 'off' ? 'Blame off' : `Blame on — ${style}`,
                3000
            );
        }),
        // Reports the blame as the decorator reads it.
        vscode.commands.registerCommand('gitHawk.blame', (path: string) =>
            blame.blameForTesting(path)
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
        /*
         * The Changes tree's own rows, as built for the view — sections,
         * folders, files, each file with the revisions its diff opens. The
         * integration tests stage and unstage through these rows rather than
         * through ones they built themselves, for the reason CLAUDE.md gives.
         */
        vscode.commands.registerCommand('gitHawk.changesTree', () =>
            changedFiles.rootsForTesting()
        ),
        // The commit itself, without the box: the same controller the box
        // drives, so what the tests commit is what the button commits.
        vscode.commands.registerCommand(
            'gitHawk.commitForTesting',
            (message: string) => commits.commit(message)
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
        /*
         * The blame card, offered to the hover widget as well as painted onto
         * the decorations. The widget is what the keyboard can open — a
         * decoration's hoverMessage is not reachable from
         * `editor.action.showHover` — so this is what lets Cmd+K H ask the same
         * question the mouse asks.
         *
         * Both schemes, matching what blame already annotates: a file on disk,
         * and the historical side of a diff.
         */
        vscode.languages.registerHoverProvider(
            [{ scheme: 'file' }, { scheme: REVISION_SCHEME }],
            {
                provideHover: (document, position) =>
                    blame.provideHover(document, position),
            }
        ),
        // Serves file contents at a revision so vscode.diff can compare two
        // historical versions, not just files on disk.
        vscode.workspace.registerTextDocumentContentProvider(
            REVISION_SCHEME,
            new RevisionContentProvider(createGitComparer)
        ),
        // Blame belongs to a file, so it is redrawn when the file being looked
        // at changes, when its content changes, and when the repository moves
        // underneath it.
        vscode.window.onDidChangeVisibleTextEditors(() =>
            blame.decorateVisible()
        ),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document === vscode.window.activeTextEditor?.document) {
                void blame.decorateVisible();
            }
        }),
        /*
         * Typing moves every line below the cursor, so the annotations are
         * wrong the moment a key is pressed — and re-running git on each
         * keystroke is not an option either. Debounced, and blamed against the
         * buffer rather than the file, so what comes back describes what is on
         * screen rather than what was last saved.
         */
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document === vscode.window.activeTextEditor?.document) {
                redrawBlame.schedule();
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
                void blame.decorateVisible();
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
    void blame.decorateVisible();
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

/** The files a tree row stands for: itself, or everything beneath a folder or section. */
function pathsBeneath(node: TreeNode | undefined): string[] {
    if (!node) {
        return [];
    }
    return filesBeneath(node).map((file) => file.change.path);
}

export function deactivate(): void {
    // Every disposable is registered on the context; only the module-level
    // handle needs clearing, so a reactivation cannot see a disposed registry.
    repositoryRegistry = undefined;
}
