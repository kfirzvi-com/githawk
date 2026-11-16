import * as vscode from 'vscode';
import { log } from './log';

/**
 * GitHawk moved from the `kfirzvi-com` publisher to `praktical`. The
 * Marketplace keeps an extension's name unique across publishers, so the new
 * identifier can only be published once the old one is gone — and a removed
 * extension never updates again. The last release under the old identifier is
 * therefore the whole of GitHawk plus this offer to switch, which keeps
 * offering on each start until the new one installs.
 *
 * Under the new identifier it does nothing.
 */
export class PublisherMoveNotice {
    static readonly OLD_ID = 'kfirzvi-com.githawk';
    static readonly NEW_ID = 'praktical.githawk';
    private static readonly HOW_TO = 'https://github.com/kfirzvi-com/githawk#install';

    static appliesTo(extensionId: string): boolean {
        return extensionId.toLowerCase() === PublisherMoveNotice.OLD_ID;
    }

    async offer(): Promise<void> {
        if (vscode.extensions.getExtension(PublisherMoveNotice.NEW_ID) !== undefined) {
            const choice = await vscode.window.showInformationMessage(
                `GitHawk now comes from ${PublisherMoveNotice.NEW_ID}, which is installed. Remove this old copy, ${PublisherMoveNotice.OLD_ID}?`,
                'Remove'
            );
            if (choice === 'Remove') {
                await this.removeOldAndReload();
            }
            return;
        }

        const choice = await vscode.window.showInformationMessage(
            `GitHawk has moved to a new publisher. Switch to ${PublisherMoveNotice.NEW_ID} to keep getting updates — your settings carry over.`,
            'Switch',
            'Later'
        );
        if (choice !== 'Switch') {
            return;
        }

        try {
            await vscode.commands.executeCommand(
                'workbench.extensions.installExtension',
                PublisherMoveNotice.NEW_ID
            );
        } catch (error) {
            log.warn(`Could not install ${PublisherMoveNotice.NEW_ID}`, error);
            const next = await vscode.window.showWarningMessage(
                `${PublisherMoveNotice.NEW_ID} could not be installed yet. GitHawk keeps working as it is, and will offer again next time.`,
                'How to switch'
            );
            if (next === 'How to switch') {
                await vscode.env.openExternal(vscode.Uri.parse(PublisherMoveNotice.HOW_TO));
            }
            return;
        }
        await this.removeOldAndReload();
    }

    /** Both copies share every command and view, so only one may stay. */
    private async removeOldAndReload(): Promise<void> {
        await vscode.commands.executeCommand(
            'workbench.extensions.uninstallExtension',
            PublisherMoveNotice.OLD_ID
        );
        const reload = await vscode.window.showInformationMessage(
            `GitHawk now comes from ${PublisherMoveNotice.NEW_ID}. Reload the window to finish switching.`,
            'Reload'
        );
        if (reload === 'Reload') {
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    }
}
