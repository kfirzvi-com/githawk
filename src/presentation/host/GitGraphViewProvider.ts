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
import type { IWorkingTreeReader } from '../../domain/repositories/IWorkingTreeReader';
import {
    cleanWorkingTree,
    type WorkingTreeStatus,
} from '../../domain/models/WorkingTreeStatus';
import { WorktreeMapper } from '../../application/dto/mappers';
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
 * discoverable without hijacking every click.
 */
type RevealMode = 'focus' | 'ifUnseen';

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
        private readonly createWorkingTreeReader: WorkingTreeReaderFactory
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
    }

    /** Re-reads the repository and pushes it to the webview, if one is open. */
    refresh(): void {
        this.forgetOtherRepositorysChanges();
        if (this.view) {
            this.sendRepositories();
            void this.sendGraph();
            void this.sendWorktrees();
            void this.sendWorkingTree();
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
        try {
            this.post({
                type: 'workingTree:loaded',
                status: await this.createWorkingTreeReader().read(),
            });
        } catch (error) {
            log.warn(`could not read the working tree: ${describeError(error)}`);
            this.post({
                type: 'workingTree:loaded',
                status: cleanWorkingTree,
            });
        }
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
     * Everything uncommitted, as one changeset. Backs both the row above the
     * graph and the command, so a keybinding reaches it without the panel being
     * open.
     */
    async compareWorkingTree(reveal: RevealMode = 'focus'): Promise<void> {
        await this.runComparison(
            {
                kind: 'twoRefs',
                left: 'HEAD',
                right: 'WORKTREE',
                rightIsWorkingTree: true,
            },
            reveal
        );
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
        try {
            const comparison = await this.comparisons.compare(spec);
            log.info(
                `compared "${comparison.label}" (${comparison.method}): ${comparison.files.length} files, ${comparison.skipped.length} skipped`
            );
            this.changedFiles.show(comparison);

            // The webview needs telling too: without this the tree fills but the
            // graph panel shows nothing, so an action looks like it did nothing.
            this.post({ type: 'comparison:loaded', comparison });

            if (reveal === 'focus' || !this.hasRevealedChanges) {
                await this.revealChangedFiles();
            }
        } catch (error) {
            log.error('comparison failed', error);
            this.changedFiles.clear();
            this.post({ type: 'comparison:cleared' });
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
            (request) => this.handleWorktreeRequest(request)
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
