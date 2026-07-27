import * as vscode from 'vscode';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
import type { IGitRepository } from '../../domain/repositories/IGitRepository';
import type { IGitWriter } from '../../domain/repositories/IGitWriter';
import { CompareRequest, GitActionMenu } from './GitActionMenu';
import { ComparisonController } from './ComparisonController';
import { CHANGED_FILES_VIEW_ID, ChangedFilesTree } from './ChangedFilesTree';
import { log } from './log';

/** Matches the `views` contribution id in package.json. */
export const GITHAWK_VIEW_ID = 'gitHawkView';

/**
 * Resolves adapters on demand. Factories rather than instances so the workspace
 * folder and commit limit are re-read on every load.
 */
export type GitRepositoryFactory = () => IGitRepository;
export type GitWriterFactory = () => IGitWriter;

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

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly createRepository: GitRepositoryFactory,
        private readonly createWriter: GitWriterFactory,
        private readonly comparisons: ComparisonController,
        private readonly changedFiles: ChangedFilesTree
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

        void this.sendGraph();
    }

    /** Re-reads the repository and pushes it to the webview, if one is open. */
    refresh(): void {
        if (this.view) {
            void this.sendGraph();
        }
    }

    private async sendGraph(): Promise<void> {
        try {
            const useCase = new LoadGitGraphUseCase(this.createRepository());
            this.post({ type: 'graph:loaded', graph: await useCase.execute() });
        } catch (error) {
            this.post({ type: 'graph:error', message: describeError(error) });
        }
    }

    private handleMessage(message: WebviewToHostMessage): void {
        log.debug(`webview → host: ${message.type}`, JSON.stringify(message));

        switch (message.type) {
            case 'graph:refresh':
                void this.sendGraph();
                break;
            case 'commit:select':
                // Clicking a commit fills the Changes tree with what it changed.
                void this.compareCommits([message.hash], 'ifUnseen');
                break;
            case 'commit:menu':
                void this.showCommitMenu(message.hash);
                break;
            case 'branch:menu':
                void this.createMenu().showForBranch({
                    name: message.name,
                    isRemote: message.isRemote,
                    isCurrent: message.isCurrent,
                });
                break;
            case 'remote:operation':
                void this.createMenu().runRemoteOperation(message.operation);
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
            const repository = await this.createRepository().getRepository();
            const commit = repository.getCommit(hash);
            if (!commit) {
                vscode.window.showWarningMessage(
                    'That commit is no longer in the loaded history. Refresh and try again.'
                );
                return;
            }

            await this.createMenu().showForCommit({
                hash: commit.hash,
                shortHash: commit.shortHash,
                subject: commit.message,
                branchNames: commit.branchNames,
                tagNames: commit.tagNames,
            });
        } catch (error) {
            vscode.window.showErrorMessage(describeError(error));
        }
    }

    private createMenu(): GitActionMenu {
        return new GitActionMenu(
            this.createWriter(),
            () => this.refresh(),
            (request) => this.handleCompareRequest(request)
        );
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

function createNonce(): string {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
