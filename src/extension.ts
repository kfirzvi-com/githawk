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
	// For now, return mock data. Later we'll integrate with VS Code Git API
	return [
		{
			hash: 'abc123',
			message: 'Initial commit',
			author: 'Developer',
			parents: [],
			refs: ['main'],
			branchHint: 'main'
		},
		{
			hash: 'def456',
			message: 'Add feature',
			author: 'Developer',
			parents: ['abc123'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'ghi789',
			message: 'Create feature branch',
			author: 'Developer',
			parents: ['def456'],
			refs: ['feature'],
			branchHint: 'feature'
		},
		{
			hash: 'jkl012',
			message: 'Merge feature branch',
			author: 'Developer',
			parents: ['def456', 'ghi789'],
			refs: ['main'],
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
		body { font-family: var(--vscode-font-family); }
		#root { width: 100%; height: 400px; }
	</style>
</head>
<body class="vscode-body">
	<h1>Git Graph</h1>
	<div id="root">Loading graph...</div>
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
