// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// Test importing gitgraph.js
try {
	const gitgraph = require('@gitgraph/js');
	console.log('Gitgraph.js loaded successfully:', gitgraph);
} catch (error) {
	console.error('Failed to load gitgraph.js:', error);
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "y" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('y.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Git Graph!');
	});
	context.subscriptions.push(disposable);

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

type CommitDTO = {
	hash: string;
	message: string;
	author?: string;
	parents: string[];
	refs: string[];
	branchHint?: string;
};

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
		getGitData().then(commits => {
			webviewView.webview.postMessage({ type: 'init', commits });
		});
	}
}

async function getGitData(): Promise<CommitDTO[]> {
	// Mock data that looks more like a real Git log
	return [
		{
			hash: 'a1b2c3d4e5f6g7h8',
			message: 'feat: add authentication system',
			author: 'John Doe',
			parents: ['b2c3d4e5f6g7h8i9'],
			refs: ['main', 'origin/main'],
			branchHint: 'main'
		},
		{
			hash: 'b2c3d4e5f6g7h8i9',
			message: 'fix: resolve memory leak in user service',
			author: 'Jane Smith',
			parents: ['c3d4e5f6g7h8i9j0'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'c3d4e5f6g7h8i9j0',
			message: 'refactor: restructure database models',
			author: 'Bob Wilson',
			parents: ['d4e5f6g7h8i9j0k1'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'd4e5f6g7h8i9j0k1',
			message: 'docs: update API documentation',
			author: 'Alice Johnson',
			parents: ['e5f6g7h8i9j0k1l2'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'e5f6g7h8i9j0k1l2',
			message: 'Merge pull request #42 from feature/user-profiles',
			author: 'GitHub',
			parents: ['f6g7h8i9j0k1l2m3', 'g7h8i9j0k1l2m3n4'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'f6g7h8i9j0k1l2m3',
			message: 'test: add unit tests for user service',
			author: 'Charlie Brown',
			parents: ['h8i9j0k1l2m3n4o5'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'g7h8i9j0k1l2m3n4',
			message: 'feat: implement user profile editing',
			author: 'Diana Prince',
			parents: ['h8i9j0k1l2m3n4o5'],
			refs: ['feature/user-profiles'],
			branchHint: 'feature/user-profiles'
		},
		{
			hash: 'h8i9j0k1l2m3n4o5',
			message: 'chore: update dependencies',
			author: 'DevBot',
			parents: ['i9j0k1l2m3n4o5p6'],
			refs: [],
			branchHint: 'main'
		}
	];
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
		.git-log-container {
			display: flex;
			height: 100vh;
			width: 100%;
		}
		.commit-list {
			flex: 1;
			border-right: 1px solid var(--vscode-panel-border);
			overflow-y: auto;
		}
		.commit-details {
			width: 300px;
			padding: 8px;
			overflow-y: auto;
			background: var(--vscode-sideBar-background);
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
			width: 60px;
			height: 20px;
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
