import * as vscode from 'vscode';
import { log } from './log';
import { isNewsworthyUpdate, notesToHtml, releaseNotes } from './whatsNew';

/** The one command the page may run, and the one its button runs. */
const RATE_COMMAND = 'gitHawk.rate';

/** Where this copy came from, as `package.json` says. */
export interface WhatsNewSource {
    readonly extensionUri: vscode.Uri;
    readonly version: string;
}

/**
 * Opens the "What's New" page after a minor or major update. The page has no
 * script: "Rate GitHawk" is a command link to `RATE_COMMAND`, the only command
 * it may run.
 */
export class WhatsNewPanel {
    private static readonly KEY = 'gitHawk.lastVersion';

    constructor(
        private readonly state: vscode.Memento,
        private readonly source: WhatsNewSource
    ) {}

    /** Remembers this version, and shows the page when it is news. */
    async onActivate(): Promise<void> {
        const current = this.source.version;
        const previous = this.state.get<string>(WhatsNewPanel.KEY);
        await this.state.update(WhatsNewPanel.KEY, current);
        if (isNewsworthyUpdate(previous, current)) {
            await this.show();
        }
    }

    private async show(): Promise<void> {
        const { version } = this.source;
        const panel = vscode.window.createWebviewPanel(
            'gitHawk.whatsNew',
            `What's New in GitHawk ${version}`,
            vscode.ViewColumn.Active,
            { enableScripts: false, enableCommandUris: [RATE_COMMAND] }
        );
        const notes = await this.readNotes();
        panel.webview.html = this.html(notes ? notesToHtml(notes) : undefined);
    }

    /** This version's notes; undefined when the changelog is missing or has none. */
    private async readNotes(): Promise<string | undefined> {
        try {
            const bytes = await vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(this.source.extensionUri, 'CHANGELOG.md')
            );
            return releaseNotes(new TextDecoder().decode(bytes), this.source.version);
        } catch (error) {
            log.error("Could not read CHANGELOG.md for What's New", error);
            return undefined;
        }
    }

    private html(notes: string | undefined): string {
        const { version } = this.source;
        const body = notes ?? '<p>Bug fixes and improvements.</p>';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); max-width: 720px; margin: 0 auto; padding: 24px; line-height: 1.5; }
    h1 { font-size: 1.6em; margin-bottom: 4px; }
    h2 { font-size: 1.15em; margin-top: 24px; }
    code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    a { color: var(--vscode-textLink-foreground); }
    .rate { margin: 32px 0 8px; padding: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
    .button { display: inline-block; margin-top: 8px; padding: 6px 14px; border-radius: 3px; text-decoration: none;
        background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<h1>What's New in GitHawk ${version}</h1>
${body}
<div class="rate">
    Enjoying GitHawk? A rating in the store helps other people find it.<br>
    <a class="button" href="command:${RATE_COMMAND}">☆ Rate GitHawk</a>
</div>
</body>
</html>`;
    }
}
