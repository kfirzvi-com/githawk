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
	private _webviewView?: vscode.WebviewView;
	
	constructor(private readonly _extensionUri: vscode.Uri) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._webviewView = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'dist'),
				vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview-ui')
			]
		};

		webviewView.webview.html = this.getWebviewContent(webviewView.webview);

		// Get Git data and send to webview
		getGitData().then(data => {
			webviewView.webview.postMessage({ 
				type: 'init', 
				commits: data.commits, 
				branches: data.branches,
				graphRows: data.graphRows 
			});
		});
	}

	private getWebviewContent(webview: vscode.Webview): string {
		const isDevelopment = process.env.NODE_ENV === 'development';
		
		if (isDevelopment) {
			// In development, load from Vite dev server
			return this.getViteWebviewContent();
		} else {
			// In production, load from built assets
			return this.getProductionWebviewContent(webview);
		}
	}

	private getViteWebviewContent(): string {
		const nonce = getNonce();
		
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline' http://localhost:5173; style-src 'unsafe-inline' http://localhost:5173; connect-src http://localhost:5173; img-src data: https:;">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Git Graph</title>
</head>
<body>
	<div id="app"></div>
	<script type="module" src="http://localhost:5173/src/main.ts"></script>
</body>
</html>`;
	}

	private getProductionWebviewContent(webview: vscode.Webview): string {
		const nonce = getNonce();
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview-ui', 'assets', 'index.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview-ui', 'assets', 'index.css'));
		
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Git Graph</title>
	<link rel="stylesheet" href="${styleUri}">
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

async function getGitData(): Promise<GitGraphData> {
	// Use the new modular architecture
	const mockRepository = new MockGitRepository();
	const controller = new GitGraphWebviewController(mockRepository);
	return controller.getInitialData();
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
