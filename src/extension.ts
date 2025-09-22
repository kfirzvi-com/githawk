// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { MockGitRepository } from './infrastructure/MockGitRepository';
import { GitGraphWebviewController, GitGraphData } from './presentation/GitGraphWebviewController';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "y" is now active!');

	// Create webview view provider for the panel
	const provider = new GitGraphViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('gitGraphView', provider)
	);

	// Register the command to open the Git Graph webview
	const graphDisposable = vscode.commands.registerCommand('y.openGitGraph', () => {
		vscode.commands.executeCommand('workbench.view.extension.gitGraphPanel');
	});
	context.subscriptions.push(graphDisposable);
}

class GitGraphViewProvider implements vscode.WebviewViewProvider {
	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')]
		};

		webviewView.webview.html = getWebviewContent(webviewView.webview, this._extensionUri);

		// Get Git data and send to webview
		getGitData().then(data => {
			webviewView.webview.postMessage({ type: 'init', commits: data.commits, branches: data.branches });
		});
	}
}

async function getGitData(): Promise<GitGraphData> {
	// Use the new modular architecture
	const mockRepository = new MockGitRepository();
	const controller = new GitGraphWebviewController(mockRepository);
	return controller.getInitialData();
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'main.js'));
	
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Git Graph</title>
	<style>
		body { 
			font-family: var(--vscode-font-family);
			margin: 0;
			padding: 0;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		.git-container {
			display: flex;
			flex-direction: column;
			height: 100vh;
			width: 100%;
		}
		.toolbar {
			display: flex;
			align-items: center;
			padding: 8px 12px;
			background: var(--vscode-titleBar-activeBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			gap: 8px;
		}
		.toolbar-button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 12px;
			border-radius: 3px;
			cursor: pointer;
			font-size: 12px;
			font-family: var(--vscode-font-family);
		}
		.toolbar-button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.toolbar-button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		.toolbar-button.secondary:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}
		.main-content {
			display: flex;
			flex: 1;
			overflow: hidden;
		}
		.branch-list {
			min-width: 150px;
			width: 200px;
			max-width: 400px;
			background: var(--vscode-sideBar-background);
			border-right: 1px solid var(--vscode-panel-border);
			overflow-y: auto;
			padding: 8px 0;
			position: relative;
		}
		.resize-handle-right {
			position: absolute;
			top: 0;
			right: -2px;
			width: 4px;
			height: 100%;
			cursor: ew-resize;
			background: transparent;
			z-index: 10;
		}
		.resize-handle-right:hover {
			background: var(--vscode-focusBorder);
		}
		.branch-section {
			margin-bottom: 16px;
		}
		.branch-section-title {
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			color: var(--vscode-descriptionForeground);
			padding: 4px 12px;
			margin-bottom: 4px;
		}
		.branch-item {
			display: flex;
			align-items: center;
			padding: 4px 12px;
			cursor: pointer;
			font-size: 13px;
		}
		.branch-item:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.branch-item.active {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}
		.branch-icon {
			margin-right: 6px;
			opacity: 0.8;
		}
		.branch-name {
			flex: 1;
		}
		.commit-area {
			display: flex;
			flex: 1;
		}
		.commit-list {
			flex: 1;
			border-right: 1px solid var(--vscode-panel-border);
			overflow-y: auto;
		}
		.commit-details {
			min-width: 200px;
			width: 300px;
			max-width: 500px;
			padding: 8px;
			overflow-y: auto;
			background: var(--vscode-sideBar-background);
			position: relative;
		}
		.resize-handle-left {
			position: absolute;
			top: 0;
			left: -2px;
			width: 4px;
			height: 100%;
			cursor: ew-resize;
			background: transparent;
			z-index: 10;
		}
		.resize-handle-left:hover {
			background: var(--vscode-focusBorder);
		}
		.commit-row {
			display: flex;
			align-items: center;
			padding: 4px 8px;
			border-bottom: 1px solid var(--vscode-list-inactiveSelectionBackground);
			cursor: pointer;
			font-size: 12px;
		}
		.commit-row:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.commit-row.selected {
			background: var(--vscode-list-activeSelectionBackground);
		}
		.commit-graph {
			width: 120px;
			height: 35px;
			margin-right: 8px;
		}
		.commit-hash {
			font-family: var(--vscode-editor-font-family);
			color: var(--vscode-textLink-foreground);
			width: 70px;
			margin-right: 8px;
		}
		.commit-message {
			flex: 1;
			margin-right: 8px;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.commit-author {
			width: 80px;
			margin-right: 8px;
			color: var(--vscode-descriptionForeground);
		}
		.commit-date {
			width: 100px;
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
		}
		.branch-ref {
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			padding: 2px 6px;
			border-radius: 3px;
			font-size: 10px;
			margin-left: 4px;
		}
		.details-section {
			margin-bottom: 16px;
		}
		.details-title {
			font-weight: bold;
			margin-bottom: 4px;
			font-size: 13px;
		}
		.details-content {
			font-size: 12px;
			line-height: 1.4;
		}
		#root {
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="root">Loading Git log...</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// This method is called when your extension is deactivated
export function deactivate() {}
