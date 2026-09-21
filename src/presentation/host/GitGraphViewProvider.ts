import * as vscode from 'vscode';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
import type { IGitRepository } from '../../domain/repositories/IGitRepository';
import type { IGitWriter } from '../../domain/repositories/IGitWriter';
import {
    BranchContext,
    CommitContext,
    CompareRequest,
    GitActionMenu,
    MenuEntries,
    WorktreeRequest,
} from './GitActionMenu';
import { ComparisonController } from './ComparisonController';
import { CHANGED_FILES_VIEW_ID, ChangedFilesTree } from './ChangedFilesTree';
import { RepositoryRegistry } from './RepositoryRegistry';
import { ActionRunner } from './ActionRunner';
import { WorktreeMenu } from './WorktreeMenu';
import { RemoteMenu } from './RemoteMenu';
import { StashMenu } from './StashMenu';
import { ListWorktreesUseCase } from '../../application/usecases/ListWorktreesUseCase';
import type { IWorktreeReader } from '../../domain/repositories/IWorktreeReader';
import type { IRemoteReader } from '../../domain/repositories/IRemoteReader';
import type { IStashReader } from '../../domain/repositories/IStashReader';
import { isClean } from '../../domain/models/WorkingTreeStatus';
import type { Branch } from '../../domain/models/Branch';
import type { IWorkingTreeReader } from '../../domain/repositories/IWorkingTreeReader';
import {
    cleanWorkingTree,
    type WorkingTreeStatus,
} from '../../domain/models/WorkingTreeStatus';
import { WorktreeMapper } from '../../application/dto/mappers';
import type { RevisionBrowser } from './RevisionBrowser';
import { baseName } from '../../domain/services/paths';
import { log } from './log';

/** Matches the `views` contribution id in package.json. */
export const GITHAWK_VIEW_ID = 'gitHawkView';

/**
 * Resolves adapters on demand. Factories rather than instances so the workspace
 * folder and commit limit are re-read on every load.
 */
export type GitRepositoryFactory = () => IGitRepository;
export type GitWriterFactory = () => IGitWriter;
export type WorktreeReaderFactory = () => IWorktreeReader;
export type RemoteReaderFactory = () => IRemoteReader;
export type StashReaderFactory = () => IStashReader;
export type WorkingTreeReaderFactory = () => IWorkingTreeReader;

/**
 * `focus` puts the Changes view in front, for an action the user explicitly asked
 * for. `ifUnseen` only does so the first time, which is enough to make the view
 * discoverable without hijacking every click. `none` is for a refresh of what
 * is already there: the tree is brought up to date and nothing moves.
 */
type RevealMode = 'focus' | 'ifUnseen' | 'none';

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    /**
     * Whether the Changes view has been surfaced yet. It is revealed once so the
     * feature is discoverable, then left alone: pulling focus to the sidebar on
     * every commit click would make the graph unusable to browse.
     */
    private hasRevealedChanges = false;
    /** How many times the Changes view has been brought to the front. */
    private reveals = 0;
    /** Which repository the Changes tree currently describes. */
    private lastRepositoryRoot?: string;
    /**
     * The last graph actually sent to the webview, and how many have been sent.
     *
     * Recorded from the message itself rather than rebuilt, so the test hook
     * below cannot pass while the webview is being sent something else.
     */
    private lastSentGraph?: { head?: string; commits: number };
    private graphsSent = 0;
    /**
     * Who else wants the working-tree counts. The commit box shows what a
     * commit would contain, and it lives in a different view with a different
     * provider — so the status is read once here and announced.
     */
    private readonly workingTreeRead = new vscode.EventEmitter<WorkingTreeStatus>();
    readonly onDidReadWorkingTree = this.workingTreeRead.event;
    /**
     * Which comparison is the one the tree should end up showing. Two can be
     * in flight at once — a background refresh of the working tree and a
     * commit the reader just clicked — and git does not answer in the order
     * it was asked. Without this the slower one landed last and won: the
     * reader clicked a commit and the tree showed the working tree.
     */
    private comparisonTicket = 0;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly createRepository: GitRepositoryFactory,
        private readonly createWriter: GitWriterFactory,
        private readonly comparisons: ComparisonController,
        private readonly changedFiles: ChangedFilesTree,
        private readonly repositories: RepositoryRegistry,
        private readonly createWorktreeReader: WorktreeReaderFactory,
        private readonly createRemoteReader: RemoteReaderFactory,
        private readonly createStashReader: StashReaderFactory,
        private readonly createWorkingTreeReader: WorkingTreeReaderFactory,
        private readonly revisions: RevisionBrowser
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
            ],
        };

        webviewView.webview.html = this.buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            (message: WebviewToHostMessage) => this.handleMessage(message)
        );

        this.sendRepositories();
        void this.sendGraph();
        void this.sendWorktrees();
        void this.sendWorkingTree();

        // Anything that was waiting for somewhere to send to. The graph is on
        // its way rather than here, which is why the webview holds a reveal it
        // cannot satisfy yet rather than dropping it.
        this.viewReady?.();
    }

    /** Re-reads the repository and pushes it to the webview, if one is open. */
    refresh(): void {
        this.forgetOtherRepositorysChanges();
        if (this.view) {
            this.sendRepositories();
            void this.sendGraph();
            void this.sendWorktrees();
        }
        // Outside the view guard, like the tree it feeds: the sidebar is
        // visible whether or not the graph panel is open.
        void this.refreshWorkingTree();
    }

    /**
     * Only the uncommitted side of things: the row's counts, the commit box,
     * and — when the Changes tree is showing the working tree — the tree
     * itself, so a file staged or saved shows up where it now belongs without
     * the sidebar being asked for again.
     *
     * Cheaper than a full refresh, which is why a document save can afford to
     * call it: two diffs and a status, no log.
     */
    async refreshWorkingTree(): Promise<void> {
        if (this.view) {
            await this.sendWorkingTree();
        } else {
            await this.readWorkingTree();
        }
        if (this.changedFiles.showsWorkingTree) {
            await this.compareWorkingTree('none');
        }
    }

    /**
     * The Changes tree survives a graph reload, which is right — but not across
     * a switch of repository. Its file list, and the revisions behind it, belong
     * to the repository it came from; clicking one afterwards would ask the new
     * repository for a commit it has never heard of.
     *
     * Done outside the `this.view` guard because the tree is in the sidebar and
     * is visible whether or not the graph panel is open.
     */
    private forgetOtherRepositorysChanges(): void {
        const root = this.repositories.active?.root;
        if (root === this.lastRepositoryRoot) {
            return;
        }

        this.lastRepositoryRoot = root;
        if (this.changedFiles.current) {
            this.changedFiles.clear();
            this.post({ type: 'comparison:cleared' });
        }
        // The Files view too: its rows name a commit of the repository it
        // came from, and opening one would ask the new repository for it.
        if (this.revisions.current) {
            this.revisions.clear();
        }
    }

    private async sendGraph(): Promise<void> {
        try {
            const useCase = new LoadGitGraphUseCase(
                this.createRepository(),
                this.createStashReader()
            );
            const graph = await useCase.execute();

            this.post({ type: 'graph:loaded', graph });

            this.lastSentGraph = {
                head: graph.commits[0]?.hash,
                commits: graph.commits.length,
            };
            this.graphsSent += 1;
        } catch (error) {
            this.post({ type: 'graph:error', message: describeError(error) });
        }
    }

    /**
     * See gitHawk.graphSnapshot. What the webview was last given, so a test can
     * tell a reload that happened from one that was merely scheduled.
     */
    graphSnapshotForTesting():
        | { head?: string; commits: number; loads: number }
        | undefined {
        return this.lastSentGraph
            ? { ...this.lastSentGraph, loads: this.graphsSent }
            : undefined;
    }

    /**
     * Sent even when there is only one repository: the webview decides whether a
     * picker is worth showing, and it cannot decide that without the count.
     */
    private sendRepositories(): void {
        this.post({
            type: 'repositories:loaded',
            repositories: [...this.repositories.all],
            activeRoot: this.repositories.active?.root,
        });
    }

    /**
     * Separate from the graph, and never allowed to fail it: an old git, or a
     * repository in an odd state, must cost the worktree list rather than the
     * whole panel.
     */
    private async sendWorktrees(): Promise<void> {
        try {
            const useCase = new ListWorktreesUseCase(this.createWorktreeReader());
            this.post({
                type: 'worktrees:loaded',
                worktrees: (await useCase.execute()).map(WorktreeMapper.toDto),
            });
        } catch (error) {
            log.warn(`could not list worktrees: ${describeError(error)}`);
            this.post({ type: 'worktrees:loaded', worktrees: [] });
        }
    }

    /**
     * Separate from the graph for the reason the worktree list is: a status
     * that cannot be read — a repository mid-operation, a filesystem that is
     * being slow — must cost the row, not the panel. A clean tree is reported
     * as clean, so the row goes away as readily as it appears.
     */
    private async sendWorkingTree(): Promise<void> {
        this.post({
            type: 'workingTree:loaded',
            status: await this.readWorkingTree(),
        });
    }

    /** The status, announced to whoever listens; clean when it cannot be read. */
    private async readWorkingTree(): Promise<WorkingTreeStatus> {
        let status: WorkingTreeStatus;
        try {
            status = await this.createWorkingTreeReader().read();
        } catch (error) {
            log.warn(`could not read the working tree: ${describeError(error)}`);
            status = cleanWorkingTree;
        }
        this.workingTreeRead.fire(status);
        return status;
    }

    private handleMessage(message: WebviewToHostMessage): void {
        log.debug(`webview → host: ${message.type}`, JSON.stringify(message));

        switch (message.type) {
            case 'graph:refresh':
                // A rescan too, so a repository cloned since the window opened
                // shows up without needing a reload. The registry's change event
                // is what reloads the graph.
                void this.repositories.refresh();
                break;
            case 'repository:menu':
                void this.repositories.pick();
                break;
            case 'branch:switch':
                void this.pickBranch();
                break;
            case 'panel:toggleMaximized':
                /*
                 * The workbench's own command, rather than anything of ours:
                 * the panel is chrome VS Code owns, it already knows whether it
                 * is maximised, and its notion of "full height" accounts for
                 * the editor group, the status bar and a second side bar. There
                 * is no API to ask which state it is in, which is why the
                 * control this comes from is a toggle rather than two.
                 */
                void vscode.commands.executeCommand(
                    'workbench.action.toggleMaximizedPanel'
                );
                break;
            case 'panel:close':
                void vscode.commands.executeCommand('workbench.action.closePanel');
                break;
            case 'stash:menu':
                void this.showStashMenu(message.ref);
                break;
            case 'worktree:menu':
                void (message.path
                    ? this.createWorktreeMenu().openByPath(message.path)
                    : this.createWorktreeMenu().showManager());
                break;
            case 'commit:select':
                // Clicking a commit fills the Changes tree with what it changed.
                void this.compareCommits([message.hash], 'ifUnseen');
                break;
            case 'workingTree:select':
                /*
                 * Everything uncommitted, staged or not, as one changeset —
                 * the same comparison the commit menu's "against my working
                 * tree" runs, from the row that represents it.
                 *
                 * Revealed every time, unlike a commit. The once-only rule
                 * exists because browsing the graph is many clicks across many
                 * commits and the sidebar should not follow each one; there is
                 * exactly one of these rows and nothing to browse through, so
                 * clicking it is only ever a request to see the files.
                 */
                void this.compareWorkingTree();
                break;
            case 'commit:menu':
                void this.showCommitMenu(message.hash);
                break;
            case 'commit:copyHash':
                void vscode.env.clipboard.writeText(message.hash).then(() =>
                    vscode.window.setStatusBarMessage(
                        `Copied ${message.hash.slice(0, 8)}`,
                        3000
                    )
                );
                break;
            case 'branch:menu':
                void this.showBranchMenu(message.name, message.isRemote);
                break;
            case 'remote:operation':
                void this.createMenu().runRemoteOperation(message.operation);
                break;
            case 'remotes:menu':
                void this.createRemoteMenu().showManager();
                break;
            case 'compare:commits':
                void this.compareCommits(message.hashes, 'focus');
                break;
            case 'compare:twoCommits':
                void this.runComparison(
                    {
                        kind: 'twoRefs',
                        left: message.left,
                        right: message.right,
                    },
                    'focus'
                );
                break;
            case 'compare:clear':
                this.changedFiles.clear();
                break;
        }
    }

    /** Handles the comparison entries offered by the commit and branch menus. */
    async handleCompareRequest(request: CompareRequest): Promise<void> {
        switch (request.kind) {
            case 'ownChanges':
                // 'focus' rather than 'ifUnseen': this was asked for explicitly,
                // so putting the sidebar in front is the whole point of it.
                await this.compareCommits([request.hash], 'focus');
                return;

            case 'myWorkAgainst':
                await this.runComparison(
                    {
                        kind: 'branchAgainstBase',
                        base: request.base,
                        // Reviewing your own work almost always means including
                        // what you have not committed yet.
                        includeWorkingTree: true,
                    },
                    'focus'
                );
                return;

            case 'againstWorkingTree':
                await this.runComparison(
                    {
                        kind: 'twoRefs',
                        left: request.left,
                        right: 'WORKTREE',
                        rightIsWorkingTree: true,
                    },
                    'focus'
                );
                return;

            case 'pickAgainst': {
                const chosen = await this.comparisons.pickRevision(
                    `Compare ${request.leftLabel} with…`
                );
                if (!chosen) {
                    return;
                }
                await this.runComparison(
                    {
                        kind: 'twoRefs',
                        left: request.left,
                        right: chosen.rev,
                        rightIsWorkingTree: chosen.isWorkingTree,
                    },
                    'focus'
                );
                return;
            }
        }
    }

    /** One selected commit shows its own changes; several are combined. */
    private async compareCommits(
        hashes: string[],
        reveal: RevealMode
    ): Promise<void> {
        if (hashes.length === 0) {
            this.changedFiles.clear();
            this.post({ type: 'comparison:cleared' });
            return;
        }

        await this.runComparison(
            hashes.length === 1
                ? { kind: 'singleCommit', hash: hashes[0] }
                : { kind: 'commitSet', hashes },
            reveal
        );
    }

    /**
     * Exposed so the comparison path can be driven without the webview — by a
     * keybinding, by automation, and by the integration tests, which is how the
     * "nothing happens" bug was finally pinned down.
     */
    async compareCommitsForTesting(hashes: string[]): Promise<void> {
        await this.compareCommits(hashes, 'focus');
    }

    /**
     * Everything uncommitted, in git's own groups — staged, changed, untracked,
     * conflicted — so the tree is the place a commit is put together. Backs
     * both the row above the graph and the command, so a keybinding reaches it
     * without the panel being open.
     */
    async compareWorkingTree(reveal: RevealMode = 'focus'): Promise<void> {
        await this.runComparison({ kind: 'workingTree' }, reveal);
    }

    /**
     * Selects a commit from outside the graph — the link in a blame hover, or
     * the editor's own shortcut. Runs the same comparison a click in the graph
     * does, so arriving from the editor leaves you where arriving from the
     * graph would.
     *
     * `fromPath` is the file the commit was found in. It matters because a
     * workspace routinely holds several repositories and the file on screen is
     * often not in the one the graph is pointed at: without it, the panel was
     * asked about a commit its repository has never heard of, and answered with
     * "GitHawk could not compare: fatal: bad object". The commit was not
     * missing and nothing was wrong — the question had simply gone to the wrong
     * repository.
     */
    async revealCommit(hash: string, fromPath?: string): Promise<void> {
        await vscode.commands.executeCommand(
            'workbench.view.extension.gitHawkPanel'
        );
        /*
         * Opening the panel does not build it. `resolveWebviewView` runs after
         * the command has already resolved, and until it does `post` has
         * nowhere to send to and silently drops — so revealing a commit with
         * the panel closed filled the Changes tree and selected nothing, which
         * looked like the graph ignoring the request.
         */
        await this.whenViewReady();
        if (fromPath) {
            await this.switchToRepositoryContaining(fromPath);
        }
        this.post({ type: 'commit:reveal', hash });
        await this.compareCommits([hash], 'focus');
    }

    /**
     * Points the panel at the repository a file belongs to, and waits for the
     * graph to arrive before returning.
     *
     * Awaited rather than left to the registry's change event, which reloads
     * the graph too but on its own schedule: the reveal that follows has to
     * land on rows that exist, or it selects a commit the webview has not been
     * told about and appears to do nothing.
     *
     * The repositories go first for the same reason. The webview clears its
     * selection when it is told the active root has changed, so announcing the
     * switch after the reveal would undo it.
     */
    private async switchToRepositoryContaining(filePath: string): Promise<void> {
        const target = this.repositories.containing(filePath);
        if (!target || target.root === this.repositories.active?.root) {
            return;
        }

        log.info(`revealing a commit from ${target.root}; switching to it`);
        this.repositories.setActive(target.root);
        this.forgetOtherRepositorysChanges();
        this.sendRepositories();
        await this.sendGraph();
        void this.sendWorktrees();
        void this.sendWorkingTree();
    }

    /** See gitHawk.changesRevealed. */
    revealsForTesting(): number {
        return this.reveals;
    }

    /** See gitHawk.workingTree: the counts as the extension reads them. */
    async workingTreeForTesting(): Promise<WorkingTreeStatus> {
        return this.createWorkingTreeReader().read();
    }

    private async runComparison(
        spec: Parameters<ComparisonController['compare']>[0],
        reveal: RevealMode
    ): Promise<void> {
        log.info(`comparing: ${JSON.stringify(spec)}`);
        const ticket = ++this.comparisonTicket;
        try {
            const comparison = await this.comparisons.compare(spec, {
                quiet: reveal === 'none',
            });
            if (ticket !== this.comparisonTicket) {
                log.debug(`dropping a comparison that was overtaken: ${comparison.label}`);
                return;
            }
            log.info(
                `compared "${comparison.label}" (${comparison.method}): ${comparison.files.length} files, ${comparison.skipped.length} skipped`
            );

            /*
             * A clean working tree is not an empty changeset to display: the
             * last file was just committed, and a tree titled "Uncommitted
             * changes" with nothing in it — and a commit box above it — would
             * be describing something that no longer exists.
             */
            if (comparison.groups && comparison.groups.length === 0) {
                this.changedFiles.clear();
                this.post({ type: 'comparison:cleared' });
                if (reveal === 'focus') {
                    vscode.window.setStatusBarMessage(
                        'GitHawk: nothing to commit — the working tree is clean',
                        4000
                    );
                }
                return;
            }

            this.changedFiles.show(comparison);

            // The webview needs telling too: without this the tree fills but the
            // graph panel shows nothing, so an action looks like it did nothing.
            this.post({ type: 'comparison:loaded', comparison });

            if (reveal === 'focus' || (reveal === 'ifUnseen' && !this.hasRevealedChanges)) {
                await this.revealChangedFiles();
            }
        } catch (error) {
            if (ticket !== this.comparisonTicket) {
                // Overtaken; whatever replaced it is what the tree shows.
                return;
            }
            log.error('comparison failed', error);
            this.changedFiles.clear();
            this.post({ type: 'comparison:cleared' });
            if (reveal === 'none') {
                // A background refresh that fails is the log's business, not a
                // dialog's: a repository mid-rebase would otherwise raise one
                // on every save.
                return;
            }
            vscode.window.showErrorMessage(
                `GitHawk could not compare: ${describeError(error)}`,
                'Show log'
            ).then((choice) => {
                if (choice === 'Show log') {
                    log.show();
                }
            });
        }
    }

    /** `<viewId>.focus` is generated by VS Code for every contributed view. */
    private async revealChangedFiles(): Promise<void> {
        this.hasRevealedChanges = true;
        this.reveals += 1;
        try {
            await vscode.commands.executeCommand(
                `${CHANGED_FILES_VIEW_ID}.focus`
            );
        } catch {
            // Not fatal: the comparison is still in the tree, just not surfaced.
        }
    }

    /**
     * The menu needs the commit's refs to offer tag deletion, and the webview's
     * copy could be stale, so it is re-read from the repository.
     */
    private async showCommitMenu(hash: string): Promise<void> {
        try {
            const context = await this.commitContext(hash);
            if (!context) {
                vscode.window.showWarningMessage(
                    'That commit is no longer in the loaded history. Refresh and try again.'
                );
                return;
            }

            await this.createMenu().showForCommit(context);
        } catch (error) {
            vscode.window.showErrorMessage(describeError(error));
        }
    }

    /** Shared with the test hook, for the reason branchContext is. */
    private async commitContext(
        hash: string
    ): Promise<CommitContext | undefined> {
        const repository = await this.createRepository().getRepository();
        const commit = repository.getCommit(hash);
        if (!commit) {
            return undefined;
        }

        return {
            hash: commit.hash,
            shortHash: commit.shortHash,
            // Subject only: the menu title must stay one line.
            subject: commit.subject,
            branchNames: commit.branchNames,
            tagNames: commit.tagNames,
        };
    }

    /**
     * Upstream state is re-read from the repository rather than taken from the
     * webview: ahead/behind counts go stale the moment anything fetches, and an
     * offer to fast-forward a branch that has since diverged would fail.
     */
    /**
     * The branch list as a picker, with the checkout already chosen.
     *
     * The sidebar can do this, in three keystrokes and a menu: filter, tab to
     * the branch, open its menu, pick "Check out". That menu is the right home
     * for everything a branch can have done to it, and the wrong one for the
     * thing people do most — so switching branch gets a way in of its own.
     *
     * A remote branch checks out as a local one tracking it, which is what
     * choosing a remote branch in order to work on it has to mean; picking the
     * branch already checked out does nothing rather than erroring, and one
     * held by another worktree says so rather than letting git refuse.
     */
    async pickBranch(): Promise<void> {
        try {
            const repository = await this.createRepository().getRepository();
            const current = repository.currentBranch?.name;

            const items: (vscode.QuickPickItem & { branch?: Branch })[] = [];
            const push = (label: string, branches: Branch[]) => {
                if (branches.length === 0) {
                    return;
                }
                items.push({
                    label,
                    kind: vscode.QuickPickItemKind.Separator,
                });
                items.push(...branches.map((branch) => this.branchItem(branch)));
            };

            // Current first, then the rest of local, then remote: the branch you
            // are on is the one you are most often coming back to.
            const locals = repository.localBranches;
            push(
                'Local',
                [
                    ...locals.filter((b) => b.isCurrent),
                    ...locals.filter((b) => !b.isCurrent),
                ]
            );
            push('Remote', repository.remoteBranches);

            if (items.length === 0) {
                vscode.window.showWarningMessage(
                    'This repository has no branches yet.'
                );
                return;
            }

            const chosen = await vscode.window.showQuickPick(items, {
                title: 'Check out which branch?',
                placeHolder: current ? `On ${current}` : 'Choose a branch',
                matchOnDescription: true,
            });
            const branch = chosen?.branch;
            if (!branch || branch.isCurrent) {
                return;
            }

            if (branch.isCheckedOutElsewhere) {
                vscode.window.showWarningMessage(
                    `${branch.name} is checked out in ${branch.worktreePath}. A branch lives in one working tree at a time — open that worktree, or make one from the branch's own menu.`
                );
                return;
            }

            await this.createMenu().checkOut(branch.name, branch.isRemote);
        } catch (error) {
            vscode.window.showErrorMessage(describeError(error));
        }
    }

    private branchItem(
        branch: Branch
    ): vscode.QuickPickItem & { branch: Branch } {
        const detail: string[] = [];
        if (branch.upstream?.isGone) {
            detail.push(`${branch.upstream.name} is gone`);
        } else if (branch.isAhead || branch.isBehind) {
            // The same question the sidebar's arrows answer: which of these
            // needs updating before it is worth standing on.
            if (branch.isBehind) {
                detail.push(`${branch.upstream?.behind} behind`);
            }
            if (branch.isAhead) {
                detail.push(`${branch.upstream?.ahead} ahead`);
            }
        }
        if (branch.isCheckedOutElsewhere && branch.worktreePath) {
            detail.push(`in ${branch.worktreePath}`);
        }

        return {
            branch,
            label: `${branch.isCurrent ? '$(check)' : branch.isRemote ? '$(cloud)' : '$(git-branch)'} ${branch.name}`,
            description: branch.isCurrent ? 'current' : detail.join(', '),
        };
    }

    private async showBranchMenu(
        name: string,
        isRemote: boolean
    ): Promise<void> {
        try {
            await this.createMenu().showForBranch(
                await this.branchContext(name, isRemote)
            );
        } catch (error) {
            vscode.window.showErrorMessage(describeError(error));
        }
    }

    /**
     * Built once and shared with the test hook below.
     *
     * Not duplicated, however small the duplication looks: a test hook that
     * assembles its own context asserts a menu no user ever sees. That has
     * already happened here — the worktree field was added to the real path and
     * not the hook, and the test passed while the feature was missing.
     */
    private async branchContext(
        name: string,
        isRemote: boolean
    ): Promise<BranchContext> {
        const repository = await this.createRepository().getRepository();
        const branch = repository.getBranch(name, isRemote ? 'remote' : 'local');

        return {
            name,
            isRemote,
            isCurrent: branch?.isCurrent ?? false,
            upstream: branch?.upstream
                ? {
                      ...branch.upstream,
                      canFastForward: branch.canFastForwardToUpstream,
                      hasDiverged: branch.hasDiverged,
                  }
                : undefined,
            checkedOutIn: worktreeHolding(branch),
            remoteNames: await this.remoteNames(),
        };
    }

    /**
     * Never allowed to cost the menu: a repository with a broken remote
     * configuration should still offer everything that does not need one.
     */
    private async remoteNames(): Promise<string[]> {
        try {
            return (await this.createRemoteReader().list()).map((r) => r.name);
        } catch (error) {
            log.warn(`could not list remotes: ${describeError(error)}`);
            return [];
        }
    }

    /**
     * A ref from the sidebar names a position, and the stack may have moved
     * since it was drawn — so the entry is looked up again by ref and the
     * manager opened if it is gone, rather than acting on whatever is there now.
     */
    private async showStashMenu(ref?: string): Promise<void> {
        const menu = this.createStashMenu();
        if (ref === undefined) {
            await menu.showManager();
            return;
        }
        await menu.showForRef(ref);
    }

    /** Exposed so a command can open the manager without going via the webview. */
    createStashMenu(): StashMenu {
        return new StashMenu({
            listStashes: () => this.createStashReader().list(),
            hasLocalChanges: async () =>
                !isClean(await this.createWorkingTreeReader().read()),
            runner: new ActionRunner(this.createWriter(), () => this.refresh()),
            /*
             * A stash entry is a commit whose first parent is the commit it was
             * made on, so what it contains is that comparison — no new
             * machinery, and it lands in the Changes tree like everything else.
             */
            showChanges: (stash) =>
                this.runComparison(
                    {
                        kind: 'twoRefs',
                        left: `${stash.hash}^`,
                        right: stash.hash,
                    },
                    'focus'
                ),
        });
    }

    /** Exposed so a command can open the manager without going via the webview. */
    createRemoteMenu(): RemoteMenu {
        return new RemoteMenu({
            listRemotes: () => this.createRemoteReader().list(),
            runner: new ActionRunner(this.createWriter(), () => this.refresh()),
        });
    }

    /** See gitHawk.branchMenuEntries: structure only, nothing shown. */
    async branchMenuEntriesForTesting(
        name: string,
        isRemote: boolean
    ): Promise<MenuEntries> {
        return this.createMenu().entriesForBranch(
            await this.branchContext(name, isRemote)
        );
    }

    /** See gitHawk.commitMenuEntries: structure only, nothing shown. */
    async commitMenuEntriesForTesting(
        hash: string
    ): Promise<MenuEntries | undefined> {
        const context = await this.commitContext(hash);
        return context ? this.createMenu().entriesForCommit(context) : undefined;
    }

    private createMenu(): GitActionMenu {
        return new GitActionMenu(
            this.createWriter(),
            () => this.refresh(),
            (request) => this.handleCompareRequest(request),
            (request) => this.handleWorktreeRequest(request),
            (hash) => this.revisions.browse(hash)
        );
    }

    /** Exposed so a command can open the manager without going via the webview. */
    createWorktreeMenu(): WorktreeMenu {
        return new WorktreeMenu({
            listWorktrees: () =>
                new ListWorktreesUseCase(this.createWorktreeReader()).execute(),
            listBranches: async () =>
                (await this.createRepository().getRepository()).branches,
            runner: new ActionRunner(this.createWriter(), () => this.refresh()),
            showInGitHawk: (path) => this.repositories.setActiveByRealPath(path),
            rescanRepositories: () => this.repositories.refresh(),
            currentRepositoryPath: () => this.repositories.rootOrThrow(),
        });
    }

    private async handleWorktreeRequest(
        request: WorktreeRequest
    ): Promise<void> {
        const menu = this.createWorktreeMenu();

        if (request.kind === 'open') {
            await menu.openByPath(request.path);
            return;
        }
        await menu.createForBranch(request.branch);
    }

    private post(message: HostToWebviewMessage): void {
        void this.view?.webview.postMessage(message);
    }

    /**
     * Resolves once there is a webview to post to.
     *
     * Timed out rather than waited on indefinitely: the panel can fail to open
     * — another view is dragged into its place, or the reader closes it as it
     * arrives — and a reveal that hangs for ever would take the command with
     * it. Giving up simply means the message is dropped, which is what used to
     * happen every time.
     */
    private viewReady?: () => void;

    private whenViewReady(timeoutMs = 5000): Promise<void> {
        if (this.view) {
            return Promise.resolve();
        }

        return new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                this.viewReady = undefined;
                resolve();
            }, timeoutMs);

            this.viewReady = () => {
                clearTimeout(timer);
                this.viewReady = undefined;
                resolve();
            };
        });
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = createNonce();
        const asset = (...segments: string[]) =>
            webview.asWebviewUri(
                vscode.Uri.joinPath(
                    this.extensionUri,
                    'dist',
                    'webview',
                    ...segments
                )
            );

        const scriptUri = asset('assets', 'main.js');
        const styleUri = asset('assets', 'main.css');

        return `<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>GitHawk</title>
</head>
<body>
	<div id="app"></div>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/**
 * Errors reach the user inside the panel, so they must read as guidance rather
 * than as a stack trace. The named error types carry usable messages already.
 */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * A branch checked out in a *different* working tree. The branch this worktree
 * is on also has a worktreePath — its own — so `isCurrent` is what separates
 * "checked out here" from "checked out elsewhere".
 */
function worktreeHolding(
    branch: { worktreePath?: string; isCheckedOutElsewhere: boolean } | undefined
): { path: string; name: string } | undefined {
    if (!branch?.isCheckedOutElsewhere || !branch.worktreePath) {
        return undefined;
    }
    return { path: branch.worktreePath, name: baseName(branch.worktreePath) };
}

function createNonce(): string {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
