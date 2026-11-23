import * as vscode from 'vscode';
import { log } from './log';
import { NEW_IDS, OLD_ID, offersMove } from './publisherMove';

/**
 * The last release under the old identifier is the whole of GitHawk plus this
 * offer to switch, which keeps offering on each start until a new one installs.
 * The new identifier differs per registry (see `publisherMove`), so the switch
 * tries each in turn and keeps the first that installs.
 *
 * Under either new identifier it does nothing.
 */
export class PublisherMoveNotice {
    private static readonly HOW_TO = 'https://github.com/kfirzvi-com/githawk#install';

    static appliesTo(extensionId: string): boolean {
        return offersMove(extensionId);
    }

    async offer(): Promise<void> {
        const installed = NEW_IDS.find((id) => vscode.extensions.getExtension(id) !== undefined);
        if (installed !== undefined) {
            const choice = await vscode.window.showInformationMessage(
                `GitHawk now comes from ${installed}, which is installed. Remove this old copy, ${OLD_ID}?`,
                'Remove'
            );
            if (choice === 'Remove') {
                await this.removeOldAndReload(installed);
            }
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            'GitHawk has moved to the Praktical publisher. Switch to keep getting updates — your settings carry over.',
            'Switch',
            'Later'
        );
        if (choice !== 'Switch') {
            return;
        }

        const switched = await this.installFirstAvailable();
        if (switched === undefined) {
            const next = await vscode.window.showWarningMessage(
                'The new GitHawk could not be installed yet. GitHawk keeps working as it is, and will offer again next time.',
                'How to switch'
            );
            if (next === 'How to switch') {
                await vscode.env.openExternal(vscode.Uri.parse(PublisherMoveNotice.HOW_TO));
            }
            return;
        }
        await this.removeOldAndReload(switched);
    }

    /** The identifier that installed, or undefined when none is in this editor's registry. */
    private async installFirstAvailable(): Promise<string | undefined> {
        for (const id of NEW_IDS) {
            try {
                await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
                return id;
            } catch (error) {
                log.warn(`Could not install ${id}`, error);
            }
        }
        return undefined;
    }

    /** Both copies share every command and view, so only one may stay. */
    private async removeOldAndReload(newId: string): Promise<void> {
        await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', OLD_ID);
        const reload = await vscode.window.showInformationMessage(
            `GitHawk now comes from ${newId}. Reload the window to finish switching.`,
            'Reload'
        );
        if (reload === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}
