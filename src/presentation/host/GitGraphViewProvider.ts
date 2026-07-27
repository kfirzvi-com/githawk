import * as vscode from 'vscode';
import type {
    HostToWebviewMessage,
    WebviewToHostMessage,
} from '../../application/dto/messages';
import { LoadGitGraphUseCase } from '../../application/usecases/LoadGitGraphUseCase';
import type { IGitRepository } from '../../domain/repositories/IGitRepository';

/** Matches the `views` contribution id in package.json. */
export const GITHAWK_VIEW_ID = 'gitHawkView';

export class GitGraphViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private readonly loadGitGraph: LoadGitGraphUseCase;

    constructor(
        private readonly extensionUri: vscode.Uri,
        gitRepository: IGitRepository
    ) {
        this.loadGitGraph = new LoadGitGraphUseCase(gitRepository);
    }

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

    private async sendGraph(): Promise<void> {
        try {
            const graph = await this.loadGitGraph.execute();
            this.post({ type: 'graph:loaded', graph });
        } catch (error) {
            this.post({
                type: 'graph:error',
                message:
                    error instanceof Error ? error.message : String(error),
            });
        }
    }

    private handleMessage(message: WebviewToHostMessage): void {
        switch (message.type) {
            case 'graph:refresh':
                void this.sendGraph();
                break;
            case 'commit:select':
                // Commit detail loading arrives with the git adapter.
                break;
            case 'branch:switch':
            case 'branch:checkoutRemote':
                vscode.window.showInformationMessage(
                    `Branch actions are not wired up yet: ${message.name}`
                );
                break;
        }
    }

    private post(message: HostToWebviewMessage): void {
        void this.view?.webview.postMessage(message);
    }

    private buildHtml(webview: vscode.Webview): string {
        const nonce = createNonce();
        const asset = (...segments: string[]) =>
            webview.asWebviewUri(
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', ...segments)
            );

        const scriptUri = asset('assets', 'main.js');
        const styleUri = asset('assets', 'main.css');

        return `<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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

function createNonce(): string {
    const alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return nonce;
}
