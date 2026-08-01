import * as vscode from 'vscode';
import { Remote } from '../../domain/models/Remote';
import { ActionRunner } from './ActionRunner';

export interface RemoteMenuDeps {
    listRemotes: () => Promise<Remote[]>;
    runner: ActionRunner;
}

interface RemoteItem extends vscode.QuickPickItem {
    remote?: Remote;
    action?: 'add';
}

const FETCH_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('cloud-download'),
    tooltip: 'Fetch this remote, pruning branches it no longer has',
};

/**
 * Manages the repository's remotes.
 *
 * GitHawk has always read remote-tracking branches and had no way to change
 * which remotes exist, so the one part of the remote story it could not do was
 * the part that sends you to a terminal — and a terminal is where a graph-driven
 * workflow ends.
 *
 * Named URLs are shown in full rather than abbreviated: the whole reason to open
 * this is usually to check or correct one, and a truncated URL answers nothing.
 */
export class RemoteMenu {
    constructor(private readonly deps: RemoteMenuDeps) {}

    async showManager(): Promise<void> {
        const remotes = await this.deps.listRemotes();

        const items: RemoteItem[] = remotes.map((remote) => ({
            label: `$(cloud) ${remote.name}`,
            description: remote.hasSeparatePushUrl
                ? `fetch: ${remote.fetchUrl} · push: ${remote.pushUrl}`
                : remote.fetchUrl,
            remote,
            buttons: [FETCH_BUTTON],
        }));

        if (remotes.length === 0) {
            items.push({
                label: 'No remotes',
                description: 'this repository exchanges commits with nowhere',
                // Not selectable: there is nothing to act on.
            });
        }

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(add) Add a remote…',
                action: 'add',
            }
        );

        const chosen = await this.pick(
            items,
            'GitHawk: remotes',
            'Choose a remote to manage'
        );

        if (chosen === undefined) {
            return;
        }
        if (chosen.kind === 'button' && chosen.item.remote) {
            await this.deps.runner.run({
                type: 'fetchRemote',
                name: chosen.item.remote.name,
                prune: true,
            });
            return;
        }
        if (chosen.item.action === 'add') {
            await this.addRemote(remotes);
            return;
        }
        if (chosen.item.remote) {
            await this.showForRemote(chosen.item.remote, remotes);
        }
    }

    /** The per-remote menu: everything git can do to one. */
    private async showForRemote(
        remote: Remote,
        all: Remote[]
    ): Promise<void> {
        const chosen = await vscode.window.showQuickPick(
            [
                {
                    label: '$(cloud-download) Fetch, pruning deleted branches',
                    id: 'fetch' as const,
                },
                {
                    label: '$(link) Change the URL…',
                    description: remote.fetchUrl,
                    id: 'set-url' as const,
                },
                {
                    label: '$(edit) Rename…',
                    id: 'rename' as const,
                },
                {
                    label: '$(trash) Prune deleted branches',
                    description: 'without fetching anything new',
                    id: 'prune' as const,
                },
                {
                    label: `$(trash) Remove ${remote.name}`,
                    description: 'and its remote-tracking branches',
                    id: 'remove' as const,
                },
            ],
            { title: remote.name, placeHolder: 'Choose an action' }
        );

        switch (chosen?.id) {
            case 'fetch':
                await this.deps.runner.run({
                    type: 'fetchRemote',
                    name: remote.name,
                    prune: true,
                });
                return;
            case 'prune':
                await this.deps.runner.run({
                    type: 'pruneRemote',
                    name: remote.name,
                });
                return;
            case 'remove':
                await this.deps.runner.run({
                    type: 'removeRemote',
                    name: remote.name,
                });
                return;
            case 'rename': {
                const to = await promptForRemoteName(
                    `New name for ${remote.name}`,
                    all.filter((r) => r.name !== remote.name),
                    remote.name
                );
                if (to && to !== remote.name) {
                    await this.deps.runner.run({
                        type: 'renameRemote',
                        from: remote.name,
                        to,
                    });
                }
                return;
            }
            case 'set-url': {
                const url = await promptForUrl(
                    `New URL for ${remote.name}`,
                    remote.fetchUrl
                );
                if (url && url !== remote.fetchUrl) {
                    await this.deps.runner.run({
                        type: 'setRemoteUrl',
                        name: remote.name,
                        url,
                    });
                }
                return;
            }
        }
    }

    private async addRemote(existing: Remote[]): Promise<void> {
        const name = await promptForRemoteName(
            'Name for the new remote',
            existing,
            existing.some((remote) => remote.name === 'origin')
                ? undefined
                : 'origin'
        );
        if (!name) {
            return;
        }

        const url = await promptForUrl(`URL for ${name}`);
        if (!url) {
            return;
        }

        await this.deps.runner.run({ type: 'addRemote', name, url });
    }

    /**
     * A QuickPick that reports which item was chosen *and* whether the choice
     * was its inline button. showQuickPick cannot: it resolves with the item and
     * discards the distinction, so the one-click fetch would be indistinguishable
     * from opening the remote's menu.
     */
    private pick(
        items: RemoteItem[],
        title: string,
        placeholder: string
    ): Promise<
        { kind: 'item' | 'button'; item: RemoteItem } | undefined
    > {
        const quickPick = vscode.window.createQuickPick<RemoteItem>();
        quickPick.title = title;
        quickPick.placeholder = placeholder;
        quickPick.matchOnDescription = true;
        quickPick.items = items;

        return new Promise((resolve) => {
            let result:
                | { kind: 'item' | 'button'; item: RemoteItem }
                | undefined;

            quickPick.onDidTriggerItemButton((event) => {
                result = { kind: 'button', item: event.item };
                quickPick.hide();
            });
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                if (selected) {
                    result = { kind: 'item', item: selected };
                }
                quickPick.hide();
            });
            // Covers Escape, clicking away, and both paths above.
            quickPick.onDidHide(() => {
                quickPick.dispose();
                resolve(result);
            });
            quickPick.show();
        });
    }

    /** See gitHawk.remotes: what the manager would list, without showing it. */
    async managerItemsForTesting(): Promise<
        { name: string; fetchUrl: string; pushUrl: string }[]
    > {
        return (await this.deps.listRemotes()).map((remote) => ({
            name: remote.name,
            fetchUrl: remote.fetchUrl,
            pushUrl: remote.pushUrl,
        }));
    }
}

async function promptForRemoteName(
    prompt: string,
    taken: Remote[],
    value?: string
): Promise<string | undefined> {
    const entered = await vscode.window.showInputBox({
        prompt,
        placeHolder: 'origin',
        value,
        validateInput: (input) => {
            const trimmed = input.trim();
            if (trimmed.length === 0) {
                return 'A name is required';
            }
            // git remote names are ref path components: no slash, and the same
            // characters a ref cannot contain.
            if (/[\s/~^:?*[\\]/.test(trimmed)) {
                return 'A remote name cannot contain a slash, a space, or any of ~ ^ : ? * [ \\';
            }
            if (trimmed.startsWith('-')) {
                return 'A remote name cannot start with "-"';
            }
            if (taken.some((remote) => remote.name === trimmed)) {
                return `${trimmed} already exists`;
            }
            return undefined;
        },
    });

    return entered?.trim() || undefined;
}

async function promptForUrl(
    prompt: string,
    value?: string
): Promise<string | undefined> {
    const entered = await vscode.window.showInputBox({
        prompt,
        placeHolder: 'git@github.com:owner/repo.git',
        value,
        validateInput: (input) => {
            const trimmed = input.trim();
            if (trimmed.length === 0) {
                return 'A URL is required';
            }
            /*
             * Not a URL grammar: git accepts scp-style addresses, plain paths,
             * and anything a configured transport helper understands, so
             * anything narrower would reject valid remotes. A leading dash is
             * the one genuine hazard — it would be read as an option.
             */
            if (trimmed.startsWith('-')) {
                return 'A URL cannot start with "-"';
            }
            return undefined;
        },
    });

    return entered?.trim() || undefined;
}
