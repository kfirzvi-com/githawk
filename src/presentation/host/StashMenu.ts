import * as vscode from 'vscode';
import { Stash } from '../../domain/models/Stash';
import { ActionRunner } from './ActionRunner';

export interface StashMenuDeps {
    listStashes: () => Promise<Stash[]>;
    /** Whether there is anything to stash, so the entry can say so. */
    hasLocalChanges: () => Promise<boolean>;
    runner: ActionRunner;
    /** Shows what an entry contains, through the usual comparison machinery. */
    showChanges: (stash: Stash) => Promise<void>;
}

interface StashItem extends vscode.QuickPickItem {
    stash?: Stash;
    action?: 'push';
}

const APPLY_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('add'),
    tooltip: 'Apply this entry, keeping it on the stash',
};

/**
 * Manages the stash.
 *
 * Shaped like the worktree and remote managers, which is the precedent here: a
 * list with the one useful action on a button, and a submenu per entry for the
 * rest.
 *
 * The stack's addressing is the thing to be careful about. `stash@{1}` is a
 * position, and dropping an entry renumbers everything below it — so an entry
 * picked from a list that is a few seconds old can name a different entry by
 * the time the action runs. Every action re-reads the list and checks the hash
 * still matches before doing anything.
 */
export class StashMenu {
    constructor(private readonly deps: StashMenuDeps) {}

    async showManager(): Promise<void> {
        const stashes = await this.deps.listStashes();
        const dirty = await this.deps.hasLocalChanges();

        const items: StashItem[] = stashes.map((stash) => ({
            label: `$(archive) ${describe(stash)}`,
            description: stash.branch ? `on ${stash.branch}` : undefined,
            detail: `${stash.ref} · ${stash.createdAt.toLocaleString()}`,
            stash,
            buttons: [APPLY_BUTTON],
        }));

        if (stashes.length === 0) {
            items.push({
                label: 'The stash is empty',
                description: 'nothing has been put aside',
            });
        }

        items.push(
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            {
                label: '$(archive) Stash the working tree…',
                description: dirty
                    ? undefined
                    : 'nothing to stash — the tree is clean',
                action: 'push',
            }
        );

        const chosen = await this.pick(items);
        if (chosen === undefined) {
            return;
        }

        if (chosen.item.action === 'push') {
            await this.push(dirty);
            return;
        }
        if (!chosen.item.stash) {
            return;
        }
        if (chosen.kind === 'button') {
            await this.run(chosen.item.stash, (fresh) => ({
                type: 'stashApply',
                ref: fresh.ref,
                hash: fresh.hash,
            }));
            return;
        }

        await this.showForStash(chosen.item.stash);
    }

    /**
     * One entry, named by the ref the sidebar drew. Re-read rather than
     * trusted: a ref is a position, and the stack may have changed since.
     */
    async showForRef(ref: string): Promise<void> {
        const stash = (await this.deps.listStashes()).find(
            (candidate) => candidate.ref === ref
        );

        if (!stash) {
            vscode.window.showWarningMessage(
                `${ref} is no longer on the stash.`
            );
            return;
        }

        await this.showForStash(stash);
    }

    /** Everything git can do to one entry. */
    private async showForStash(stash: Stash): Promise<void> {
        const chosen = await vscode.window.showQuickPick(
            [
                {
                    label: '$(diff) Show what is in it',
                    description: 'in the Changes tree',
                    id: 'show' as const,
                },
                {
                    label: '$(add) Apply, and keep it on the stash',
                    id: 'apply' as const,
                },
                {
                    label: '$(check) Pop — apply and remove it',
                    id: 'pop' as const,
                },
                {
                    label: '$(trash) Drop it',
                    description: 'without applying',
                    id: 'drop' as const,
                },
            ],
            {
                title: describe(stash),
                placeHolder: 'Choose an action',
            }
        );

        switch (chosen?.id) {
            case 'show':
                await this.deps.showChanges(stash);
                return;
            case 'apply':
                await this.run(stash, (fresh) => ({
                    type: 'stashApply',
                    ref: fresh.ref,
                    hash: fresh.hash,
                }));
                return;
            case 'pop':
                await this.run(stash, (fresh) => ({
                    type: 'stashPop',
                    ref: fresh.ref,
                    hash: fresh.hash,
                }));
                return;
            case 'drop':
                await this.run(stash, (fresh) => ({
                    type: 'stashDrop',
                    ref: fresh.ref,
                    hash: fresh.hash,
                }));
                return;
        }
    }

    private async push(dirty: boolean): Promise<void> {
        if (!dirty) {
            vscode.window.showInformationMessage(
                'Nothing to stash — the working tree is clean.'
            );
            return;
        }

        const message = await vscode.window.showInputBox({
            title: 'Stash the working tree',
            prompt: 'A message, so the entry says what it is',
            placeHolder: 'Left blank, git writes one that describes the commit you were on',
        });
        // Escape cancels; an empty box is a deliberate "let git name it".
        if (message === undefined) {
            return;
        }

        const untracked = await vscode.window.showQuickPick(
            [
                {
                    label: 'Tracked changes only',
                    description: 'files git already knows about',
                    include: false,
                },
                {
                    label: 'Include untracked files',
                    description: 'also sweeps up new files git has never seen',
                    include: true,
                },
            ],
            { title: 'What should go in?' }
        );
        if (!untracked) {
            return;
        }

        await this.deps.runner.run({
            type: 'stashPush',
            message: message.trim() || undefined,
            includeUntracked: untracked.include,
            keepIndex: false,
        });
    }

    /**
     * Re-reads the stack and checks the entry is still where it was.
     *
     * The window between listing and acting is small but the consequence is
     * not: `stash@{1}` names whatever is second on the stack *now*, so acting
     * on a stale ref drops or applies the wrong entry, silently and
     * successfully.
     */
    private async run(
        stash: Stash,
        action: (fresh: Stash) => Parameters<ActionRunner['run']>[0]
    ): Promise<void> {
        const fresh = (await this.deps.listStashes()).find(
            (candidate) => candidate.hash === stash.hash
        );

        if (!fresh) {
            vscode.window.showWarningMessage(
                `${stash.ref} is no longer on the stash. It may have been applied or dropped elsewhere.`
            );
            return;
        }

        await this.deps.runner.run(action(fresh));
    }

    private pick(
        items: StashItem[]
    ): Promise<{ kind: 'item' | 'button'; item: StashItem } | undefined> {
        const quickPick = vscode.window.createQuickPick<StashItem>();
        quickPick.title = 'GitHawk: the stash';
        quickPick.placeholder = 'Choose an entry';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.items = items;

        return new Promise((resolve) => {
            let result:
                | { kind: 'item' | 'button'; item: StashItem }
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
            quickPick.onDidHide(() => {
                quickPick.dispose();
                resolve(result);
            });
            quickPick.show();
        });
    }

    /** See gitHawk.stashes: what the manager would list, without showing it. */
    async managerItemsForTesting(): Promise<
        {
            ref: string;
            hash: string;
            branch: string;
            message: string;
            isAutoNamed: boolean;
        }[]
    > {
        return (await this.deps.listStashes()).map((stash) => ({
            ref: stash.ref,
            hash: stash.hash,
            branch: stash.branch,
            message: stash.message,
            isAutoNamed: stash.isAutoNamed,
        }));
    }
}

/**
 * What an entry is called. A git-written message describes the commit the work
 * was sitting on rather than the work, so it is shown but marked — otherwise
 * a list of them reads as though each entry were about that commit.
 */
function describe(stash: Stash): string {
    return stash.isAutoNamed ? `${stash.message} (unnamed)` : stash.message;
}
