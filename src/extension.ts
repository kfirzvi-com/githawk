import * as vscode from 'vscode';
import { InMemoryGitRepository } from './infrastructure/fixtures/InMemoryGitRepository';
import {
    GITLIBRE_VIEW_ID,
    GitGraphViewProvider,
} from './presentation/host/GitGraphViewProvider';

/**
 * Composition root: the only place that picks concrete adapters. Swapping the
 * fixture repository for GitCliRepository is a one-line change here.
 */
export function activate(context: vscode.ExtensionContext): void {
    const gitRepository = new InMemoryGitRepository();
    const provider = new GitGraphViewProvider(context.extensionUri, gitRepository);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(GITLIBRE_VIEW_ID, provider),
        vscode.commands.registerCommand('gitLibre.open', () =>
            vscode.commands.executeCommand(
                'workbench.view.extension.gitLibrePanel'
            )
        )
    );
}

export function deactivate(): void {
    // Nothing to tear down: every disposable is registered on the context.
}
