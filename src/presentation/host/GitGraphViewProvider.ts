import * as vscode from 'vscode';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
import type { IGitRepository } from '../../domain/repositories/IGitRepository';
import type { IGitWriter } from '../../domain/repositories/IGitWriter';
import { GitActionMenu } from './GitActionMenu';
import { ComparisonController } from './ComparisonController';

/** Matches the `views` contribution id in package.json. */
export const GITHAWK_VIEW_ID = 'gitHawkView';

/**
 * Resolves adapters on demand. Factories rather than instances so the workspace
 * folder and commit limit are re-read on every load.
 */
export type GitRepositoryFactory = () => IGitRepository;
export type GitWriterFactory = () => IGitWriter;

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly createRepository: GitRepositoryFactory,
        private readonly createWriter: GitWriterFactory,
        private readonly comparisons: ComparisonController
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
        switch (message.type) {
            case 'graph:refresh':
                void this.sendGraph();
                break;
            case 'commit:select':
                // The webview already holds everything the details panel needs.
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
            case 'compare:branch':
                void this.compareBranch(message.base, message.includeWorkingTree);
                break;
            case 'compare:commits':
                void this.compareCommits(message.hashes);
                break;
            case 'compare:clear':
                this.post({ type: 'comparison:cleared' });
                break;
            case 'compare:openFile':
                void this.comparisons
                    .openFile(message)
                    .catch((error) =>
                        vscode.window.showErrorMessage(describeError(error))
                    );
                break;
        }
    }

    private async compareBranch(
        base: string | undefined,
        includeWorkingTree: boolean
    ): Promise<void> {
        const resolved = await this.comparisons.resolveBaseBranch(base);
        if (!resolved) {
            return;
        }

        await this.runComparison({
            kind: 'branchAgainstBase',
            base: resolved,
            includeWorkingTree,
        });
    }

    private async compareCommits(hashes: string[]): Promise<void> {
        if (hashes.length === 0) {
            this.post({ type: 'comparison:cleared' });
            return;
        }

        await this.runComparison({ kind: 'commitSet', hashes });
    }

    private async runComparison(
        spec: Parameters<ComparisonController['compare']>[0]
    ): Promise<void> {
        this.post({ type: 'comparison:loading' });
        try {
            const comparison = await this.comparisons.compare(spec);
            this.post({ type: 'comparison:loaded', comparison });
        } catch (error) {
            this.post({
                type: 'comparison:error',
                message: describeError(error),
            });
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
        return new GitActionMenu(this.createWriter(), () => this.refresh());
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
