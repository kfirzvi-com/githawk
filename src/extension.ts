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

type BranchDTO = {
	name: string;
	type: 'local' | 'remote';
	current: boolean;
	commit: string;
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
		getGitData().then(data => {
			webviewView.webview.postMessage({ type: 'init', commits: data.commits, branches: data.branches });
		});
	}
}

async function getGitData(): Promise<{ commits: CommitDTO[], branches: BranchDTO[] }> {
	// Complex mock data with multiple branches and realistic merge patterns
	const commits: CommitDTO[] = [
		{
			hash: 'a1b2c3d4e5f6g7h8',
			message: 'Merge pull request #89 from hotfix/critical-security-fix',
			author: 'GitHub',
			parents: ['b2c3d4e5f6g7h8i9', 'z9y8x7w6v5u4t3s2'],
			refs: ['main', 'origin/main', 'HEAD'],
			branchHint: 'main'
		},
		{
			hash: 'b2c3d4e5f6g7h8i9',
			message: 'Merge branch \'develop\' into main',
			author: 'Release Bot',
			parents: ['c3d4e5f6g7h8i9j0', 'p0o9n8m7l6k5j4i3'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'z9y8x7w6v5u4t3s2',
			message: 'fix: patch critical security vulnerability in auth',
			author: 'Security Team',
			parents: ['c3d4e5f6g7h8i9j0'],
			refs: ['hotfix/critical-security-fix'],
			branchHint: 'hotfix/critical-security-fix'
		},
		{
			hash: 'c3d4e5f6g7h8i9j0',
			message: 'feat: add user dashboard with analytics',
			author: 'John Doe',
			parents: ['d4e5f6g7h8i9j0k1'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'p0o9n8m7l6k5j4i3',
			message: 'Merge feature/notification-system into develop',
			author: 'Lead Developer',
			parents: ['q1w2e3r4t5y6u7i8', 'l2m3n4o5p6q7r8s9'],
			refs: ['develop', 'origin/develop'],
			branchHint: 'develop'
		},
		{
			hash: 'd4e5f6g7h8i9j0k1',
			message: 'refactor: improve database connection pooling',
			author: 'Alice Johnson',
			parents: ['e5f6g7h8i9j0k1l2'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'q1w2e3r4t5y6u7i8',
			message: 'Merge feature/user-profiles into develop',
			author: 'Diana Prince',
			parents: ['e5f6g7h8i9j0k1l2', 'g7h8i9j0k1l2m3n4'],
			refs: [],
			branchHint: 'develop'
		},
		{
			hash: 'l2m3n4o5p6q7r8s9',
			message: 'feat: add real-time push notifications',
			author: 'Mike Chen',
			parents: ['m3n4o5p6q7r8s9t0'],
			refs: ['feature/notification-system'],
			branchHint: 'feature/notification-system'
		},
		{
			hash: 'e5f6g7h8i9j0k1l2',
			message: 'docs: update API documentation for v2.0',
			author: 'Technical Writer',
			parents: ['f6g7h8i9j0k1l2m3'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'g7h8i9j0k1l2m3n4',
			message: 'feat: implement user profile avatar upload',
			author: 'Diana Prince',
			parents: ['h8i9j0k1l2m3n4o5'],
			refs: ['feature/user-profiles'],
			branchHint: 'feature/user-profiles'
		},
		{
			hash: 'f6g7h8i9j0k1l2m3',
			message: 'test: add comprehensive integration tests',
			author: 'Charlie Brown',
			parents: ['h8i9j0k1l2m3n4o5'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'm3n4o5p6q7r8s9t0',
			message: 'feat: add notification preferences UI',
			author: 'Sarah Wilson',
			parents: ['n4o5p6q7r8s9t0u1'],
			refs: [],
			branchHint: 'feature/notification-system'
		},
		{
			hash: 'h8i9j0k1l2m3n4o5',
			message: 'feat: add basic user profile management',
			author: 'Diana Prince',
			parents: ['i9j0k1l2m3n4o5p6'],
			refs: [],
			branchHint: 'feature/user-profiles'
		},
		{
			hash: 'n4o5p6q7r8s9t0u1',
			message: 'feat: implement WebSocket notification service',
			author: 'Mike Chen',
			parents: ['i9j0k1l2m3n4o5p6'],
			refs: [],
			branchHint: 'feature/notification-system'
		},
		{
			hash: 'i9j0k1l2m3n4o5p6',
			message: 'chore: update dependencies to latest versions',
			author: 'Dependabot',
			parents: ['j0k1l2m3n4o5p6q7'],
			refs: [],
			branchHint: 'main'
		},
		{
			hash: 'j0k1l2m3n4o5p6q7',
			message: 'Initial commit with project structure',
			author: 'Project Lead',
			parents: [],
			refs: [],
			branchHint: 'main'
		}
	];

	const branches: BranchDTO[] = [
		// Local branches
		{ name: 'main', type: 'local', current: true, commit: 'a1b2c3d4e5f6g7h8' },
		{ name: 'develop', type: 'local', current: false, commit: 'p0o9n8m7l6k5j4i3' },
		{ name: 'feature/user-profiles', type: 'local', current: false, commit: 'g7h8i9j0k1l2m3n4' },
		{ name: 'feature/notification-system', type: 'local', current: false, commit: 'l2m3n4o5p6q7r8s9' },
		{ name: 'hotfix/critical-security-fix', type: 'local', current: false, commit: 'z9y8x7w6v5u4t3s2' },
		{ name: 'feature/api-v2', type: 'local', current: false, commit: 'e5f6g7h8i9j0k1l2' },
		{ name: 'bugfix/authentication-timeout', type: 'local', current: false, commit: 'd4e5f6g7h8i9j0k1' },
		
		// Remote branches  
		{ name: 'origin/main', type: 'remote', current: false, commit: 'b2c3d4e5f6g7h8i9' },
		{ name: 'origin/develop', type: 'remote', current: false, commit: 'q1w2e3r4t5y6u7i8' },
		{ name: 'origin/feature/user-profiles', type: 'remote', current: false, commit: 'h8i9j0k1l2m3n4o5' },
		{ name: 'origin/feature/notification-system', type: 'remote', current: false, commit: 'm3n4o5p6q7r8s9t0' },
		{ name: 'origin/hotfix/critical-security-fix', type: 'remote', current: false, commit: 'z9y8x7w6v5u4t3s2' },
		{ name: 'upstream/main', type: 'remote', current: false, commit: 'c3d4e5f6g7h8i9j0' },
		{ name: 'upstream/develop', type: 'remote', current: false, commit: 'p0o9n8m7l6k5j4i3' },
		{ name: 'fork/feature/experimental', type: 'remote', current: false, commit: 'f6g7h8i9j0k1l2m3' }
	];

	return { commits, branches };
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
