import * as vscode from 'vscode';
import type {
    CommitViewToHostMessage,
    HostToCommitViewMessage,
} from '../../application/dto/messages';
import {
    cleanWorkingTree,
    type WorkingTreeStatus,
} from '../../domain/models/WorkingTreeStatus';
import { CommitController } from './CommitController';
import { commitMessageTools } from './config';
import { log } from './log';

/** Matches the `views` contribution id in package.json. */
export const COMMIT_VIEW_ID = 'gitHawkCommit';

/** Where the last-used tool is remembered, across windows. */
const SELECTED_TOOL_KEY = 'gitHawk.commitMessageTool';

/**
 * The commit box: a message, a tool to write one, and a button.
 *
 * A webview rather than anything native because VS Code has no text input
 * for a contributed view — its own Source Control input is not available to
 * extensions. It is kept as small as that fact allows: the file list stays a
 * native tree directly below, and every git operation goes through the
 * controller, so the webview owns nothing but a textarea and a select.
 *
 * The view is shown by a `when` clause only while the Changes tree shows the
 * working tree, and VS Code disposes a hidden view — so everything worth
 * keeping, the draft above all, lives here rather than in the page.
 */
export class CommitViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private status: WorkingTreeStatus = cleanWorkingTree;
    private draft = '';
    private busy = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly memento: vscode.Memento,
        private readonly controller: CommitController
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
            (message: CommitViewToHostMessage) => this.handleMessage(message)
        );
        webviewView.onDidDispose(() => {
            if (this.view === webviewView) {
                this.view = undefined;
            }
        });
    }

    /** The counts the graph's row shows, so the box can say what it will commit. */
    setStatus(status: WorkingTreeStatus): void {
        this.status = status;
        this.sendState();
    }

    /** Brings the box to the front and puts the caret in it. */
    async focus(): Promise<void> {
        try {
            await vscode.commands.executeCommand(`${COMMIT_VIEW_ID}.focus`);
        } catch {
            // The view is hidden by its `when` clause: nothing to commit.
        }
    }

    /**
     * The palette's way in: writes with the remembered tool, or asks which
     * when none is remembered, and puts the answer in the box.
     */
    async generateFromCommand(): Promise<void> {
        const tools = commitMessageTools();
        if (tools.length === 0) {
            vscode.window.showWarningMessage(
                'No AI CLI is configured to write commit messages. Add a commitMessageCommand to an entry in gitHawk.aiTools.'
            );
            return;
        }

        const remembered = this.selectedTool(tools.map((tool) => tool.name));
        const tool =
            tools.find((candidate) => candidate.name === remembered) ??
            (tools.length === 1
                ? tools[0]
                : (
                      await vscode.window.showQuickPick(
                          tools.map((candidate) => ({
                              label: `$(sparkle) ${candidate.name}`,
                              description: candidate.commitMessageCommand,
                              tool: candidate,
                          })),
                          { title: 'Write the commit message with…' }
                      )
                  )?.tool);
        if (!tool) {
            return;
        }

        await this.generate(tool.name);
    }

    private async handleMessage(message: CommitViewToHostMessage): Promise<void> {
        log.debug(`commit view → host: ${message.type}`);

        switch (message.type) {
            case 'commit:ready':
                this.sendState();
                break;
            case 'commit:draft':
                this.draft = message.message;
                break;
            case 'commit:selectTool':
                await this.memento.update(SELECTED_TOOL_KEY, message.tool);
                break;
            case 'commit:generate':
                await this.generate(message.tool);
                break;
            case 'commit:submit':
                await this.commit(message.message);
                break;
            case 'commit:stageAll':
                await this.controller.stageAll();
                break;
        }
    }

    private async generate(toolName: string): Promise<void> {
        const tool = commitMessageTools().find((t) => t.name === toolName);
        if (!tool) {
            vscode.window.showWarningMessage(
                `${toolName} is no longer configured to write commit messages.`
            );
            this.sendState();
            return;
        }

        await this.memento.update(SELECTED_TOOL_KEY, tool.name);
        await this.whileBusy(async () => {
            const message = await this.controller.generate(tool);
            if (message !== undefined) {
                this.draft = message;
                this.post({ type: 'commit:generated', message });
                await this.focus();
            }
        });
    }

    private async commit(message: string): Promise<void> {
        await this.whileBusy(async () => {
            if (await this.controller.commit(message)) {
                this.draft = '';
                this.post({ type: 'commit:committed' });
            }
        });
    }

    private async whileBusy(work: () => Promise<void>): Promise<void> {
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.sendState();
        try {
            await work();
        } finally {
            this.busy = false;
            this.sendState();
        }
    }

    private selectedTool(available: string[]): string | null {
        const remembered = this.memento.get<string>(SELECTED_TOOL_KEY);
        if (remembered && available.includes(remembered)) {
            return remembered;
        }
        return available[0] ?? null;
    }

    private sendState(): void {
        const tools = commitMessageTools().map((tool) => tool.name);
        this.post({
            type: 'commit:state',
            status: this.status,
            tools,
            selectedTool: this.selectedTool(tools),
            draft: this.draft,
            busy: this.busy,
        });
    }

    private post(message: HostToCommitViewMessage): void {
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

        return `<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${asset('assets', 'commit.css')}">
	<title>Commit</title>
</head>
<body>
	<div id="app"></div>
	<script type="module" nonce="${nonce}" src="${asset('assets', 'commit.js')}"></script>
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
