import * as vscode from 'vscode';
import { Branch } from '../../domain/models/Branch';
import { Worktree } from '../../domain/models/Worktree';
import {
    describePathProblem,
    existingWorktreeAt,
    prunableWorktrees,
    suggestWorktreePath,
} from '../../domain/services/worktreeRules';
import { ActionRunner } from './ActionRunner';
import { AiTool, aiTools } from './config';
import { log } from './log';

export interface WorktreeMenuDeps {
    listWorktrees: () => Promise<Worktree[]>;
    /** Local branches, for choosing what a new worktree should check out. */
    listBranches: () => Promise<Branch[]>;
    runner: ActionRunner;
    /**
     * Points GitHawk at a worktree. Returns false when it is not one of the
     * discovered repositories — usually because it sits outside the workspace,
     * or deeper than the repository scan reaches.
     */
    showInGitHawk: (path: string) => boolean;
    /**
     * Re-runs the repository scan. A worktree created a moment ago is not in it
     * yet, so without this "Show in GitHawk" would fail on the one path where it
     * is most obviously expected to work.
     */
    rescanRepositories: () => Promise<void>;
    /** Where a terminal opens when no worktree is named. */
    currentRepositoryPath: () => string;
}

interface WorktreeItem extends vscode.QuickPickItem {
    worktree?: Worktree;
    action?: 'create' | 'prune';
}

const NEW_WINDOW_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('empty-window'),
    tooltip: 'Open in a new VS Code window',
};
const TERMINAL_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('terminal'),
    tooltip: 'Open a terminal here',
};
const AI_BUTTON: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('sparkle'),
    tooltip: 'Start an AI CLI here',
};

/**
 * Manages a repository's working trees.
 *
 * A worktree is the answer to "I need to look at another branch without
 * disturbing what I am doing", and the reason it stays niche is that the
 * commands are unmemorable and the failure modes are opaque — git refuses a
 * checkout because a directory you deleted last month still has a record.
 * Everything here is aimed at that: name the rule rather than relay the error,
 * and make the useful next step one click away.
 */
export class WorktreeMenu {
    constructor(private readonly deps: WorktreeMenuDeps) {}

    /** The manager: every worktree, plus creating one and pruning stale records. */
    async showManager(): Promise<void> {
        const worktrees = await this.deps.listWorktrees();
        const stale = prunableWorktrees(worktrees);

        const items: WorktreeItem[] = worktrees.map((worktree) => ({
            label: `${worktree.isCurrent ? '$(check)' : '$(folder)'} ${worktree.name}`,
            description: describeWorktree(worktree),
            detail: worktree.path,
            worktree,
            // The two things worth doing without opening a submenu first.
            buttons: worktree.isPrunable
                ? []
                : [NEW_WINDOW_BUTTON, TERMINAL_BUTTON, AI_BUTTON],
        }));

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({
            label: '$(new-folder) Create a worktree…',
            description: 'check a branch out into its own directory',
            action: 'create',
        });
        if (stale.length > 0) {
            items.push({
                label: `$(trash) Prune ${stale.length} stale record(s)`,
                description: 'directories git can no longer find',
                action: 'prune',
            });
        }

        const chosen = await this.pick(items, {
            title: 'GitHawk: worktrees',
            placeholder:
                worktrees.length > 1
                    ? 'Choose a worktree, or create one'
                    : 'This repository has one worktree',
        });

        if (!chosen) {
            return;
        }
        if (chosen.action === 'create') {
            await this.createWorktree();
            return;
        }
        if (chosen.action === 'prune') {
            await this.deps.runner.run({ type: 'pruneWorktrees' });
            return;
        }
        if (chosen.worktree) {
            await this.showForWorktree(chosen.worktree);
        }
    }

    /** Actions for one worktree. Also reachable straight from the branch menu. */
    async showForWorktree(worktree: Worktree): Promise<void> {
        interface Item extends vscode.QuickPickItem {
            run?: () => Promise<void>;
        }

        const open: Item[] = [];
        if (!worktree.isCurrent && !worktree.isBare) {
            open.push({
                label: `$(eye) Show ${worktree.name} in GitHawk`,
                description: 'stays in this window',
                run: async () => this.showHere(worktree),
            });
        }
        open.push(
            {
                label: '$(empty-window) Open in a new VS Code window',
                run: async () => this.openInNewWindow(worktree.path),
            },
            {
                label: '$(terminal) Open a terminal here',
                run: async () => this.openTerminal(worktree.path, worktree.name),
            },
            {
                label: '$(sparkle) Start an AI CLI here…',
                description: aiTools()
                    .map((tool) => tool.name)
                    .join(', '),
                run: async () => this.startAiTool(worktree.path, worktree.name),
            }
        );

        const manage: Item[] = [];
        if (worktree.canLock) {
            manage.push({
                label: '$(lock) Lock this worktree…',
                description: 'stops prune from discarding it',
                run: async () => {
                    const reason = await vscode.window.showInputBox({
                        prompt: 'Why is it locked? (optional)',
                        placeHolder: 'on an external drive',
                    });
                    // Cancelling the box returns undefined; an empty string is a
                    // deliberate "no reason", and both are fine here.
                    await this.deps.runner.run({
                        type: 'lockWorktree',
                        path: worktree.path,
                        reason: reason?.trim() || undefined,
                    });
                },
            });
        }
        if (worktree.isLocked) {
            manage.push({
                label: '$(unlock) Unlock this worktree',
                description: worktree.lockReason,
                run: async () => {
                    await this.deps.runner.run({
                        type: 'unlockWorktree',
                        path: worktree.path,
                    });
                },
            });
        }
        if (worktree.canRemove) {
            manage.push({
                label: '$(trash) Remove this worktree',
                description: 'deletes the directory',
                run: async () => this.removeWorktree(worktree),
            });
        }

        const items: Item[] = [
            { label: 'Open', kind: vscode.QuickPickItemKind.Separator },
            ...open,
        ];
        if (manage.length > 0) {
            items.push(
                { label: 'Manage', kind: vscode.QuickPickItemKind.Separator },
                ...manage
            );
        }

        const chosen = await vscode.window.showQuickPick(items, {
            title: `${worktree.name} — ${describeWorktree(worktree)}`,
            placeHolder: worktree.path,
        });

        await chosen?.run?.();
    }

    /** Entry point for "open the worktree holding this branch". */
    async openByPath(path: string): Promise<void> {
        const worktree = (await this.deps.listWorktrees()).find(
            (candidate) => candidate.path === path
        );

        if (!worktree) {
            // The branch listing said a worktree held it; the listing disagrees.
            // Almost always a directory deleted by hand, whose record survives.
            const choice = await vscode.window.showWarningMessage(
                `GitHawk cannot find a worktree at ${path}.`,
                'Prune stale records',
                'Show log'
            );
            if (choice === 'Prune stale records') {
                await this.deps.runner.run({ type: 'pruneWorktrees' });
            } else if (choice === 'Show log') {
                log.show();
            }
            return;
        }

        await this.showForWorktree(worktree);
    }

    /**
     * Creates a worktree for a branch that already exists — the branch menu's
     * "Create a worktree for …".
     */
    async createForBranch(branchName: string): Promise<void> {
        const worktrees = await this.deps.listWorktrees();
        const main = worktrees.find((worktree) => worktree.isMain);
        if (!main) {
            vscode.window.showErrorMessage(
                'GitHawk could not determine where this repository lives.'
            );
            return;
        }

        const path = await this.promptForPath(
            suggestWorktreePath(main.path, branchName),
            worktrees,
            `Directory for a worktree on ${branchName}`
        );
        if (!path) {
            return;
        }

        const created = await this.deps.runner.run({
            type: 'addWorktree',
            path,
            ref: branchName,
        });
        if (created) {
            await this.offerToOpen(path);
        }
    }

    /** The manager's "Create a worktree…": pick what to check out, then where. */
    private async createWorktree(): Promise<void> {
        const [worktrees, branches] = await Promise.all([
            this.deps.listWorktrees(),
            this.deps.listBranches(),
        ]);
        const main = worktrees.find((worktree) => worktree.isMain);
        if (!main) {
            return;
        }

        interface RefItem extends vscode.QuickPickItem {
            branch?: string;
            isNew?: boolean;
        }

        const taken = new Set(
            worktrees
                .map((worktree) => worktree.branch)
                .filter((name): name is string => name !== undefined)
        );

        const items: RefItem[] = [
            {
                label: '$(add) New branch…',
                description: 'branched from the current HEAD',
                isNew: true,
            },
            { label: 'Existing branches', kind: vscode.QuickPickItemKind.Separator },
            ...branches
                .filter((branch) => branch.isLocal)
                .map((branch) => ({
                    label: branch.name,
                    // Listed but flagged: git will refuse, and saying so here is
                    // more use than letting the attempt fail.
                    description: taken.has(branch.name)
                        ? 'already checked out in a worktree'
                        : undefined,
                    branch: branch.name,
                })),
        ];

        const chosen = await vscode.window.showQuickPick(items, {
            title: 'New worktree',
            placeHolder: 'What should it check out?',
        });
        if (!chosen) {
            return;
        }

        if (chosen.isNew) {
            await this.createOnNewBranch(main.path, worktrees);
            return;
        }
        if (chosen.branch) {
            await this.createForBranch(chosen.branch);
        }
    }

    private async createOnNewBranch(
        mainPath: string,
        worktrees: Worktree[]
    ): Promise<void> {
        const branch = await vscode.window.showInputBox({
            prompt: 'New branch name',
            placeHolder: 'feature/login',
            validateInput: (input) =>
                input.trim().length === 0 ? 'A name is required' : undefined,
        });
        if (!branch?.trim()) {
            return;
        }

        const path = await this.promptForPath(
            suggestWorktreePath(mainPath, branch.trim()),
            worktrees,
            `Directory for a worktree on ${branch.trim()}`
        );
        if (!path) {
            return;
        }

        const created = await this.deps.runner.run({
            type: 'addWorktree',
            path,
            ref: 'HEAD',
            newBranch: branch.trim(),
        });
        if (created) {
            await this.offerToOpen(path);
        }
    }

    private async promptForPath(
        suggestion: string,
        worktrees: Worktree[],
        prompt: string
    ): Promise<string | undefined> {
        const entered = await vscode.window.showInputBox({
            prompt,
            value: suggestion,
            // Pre-selects the last segment, so accepting the suggested location
            // and renaming only the directory takes one edit.
            valueSelection: [suggestion.lastIndexOf('/') + 1, suggestion.length],
            validateInput: (input) => {
                const problem = describePathProblem(input);
                if (problem) {
                    return problem;
                }
                const existing = existingWorktreeAt(worktrees, input);
                return existing
                    ? `Already a worktree, on ${existing.checkedOut}`
                    : undefined;
            },
        });

        return entered?.trim() || undefined;
    }

    /** After creating one, the next thing anyone wants is to be in it. */
    private async offerToOpen(path: string): Promise<void> {
        const choice = await vscode.window.showInformationMessage(
            `Worktree created at ${path}.`,
            'Show in GitHawk',
            'Open in a new window',
            'Start an AI CLI'
        );

        if (choice === 'Show in GitHawk') {
            // Rescan first: the directory did not exist when the last scan ran.
            await this.deps.rescanRepositories();
            if (!this.deps.showInGitHawk(path)) {
                vscode.window.showInformationMessage(
                    `GitHawk did not find ${path} in the workspace. Raise gitHawk.repositoryScanDepth, or open it in its own window.`
                );
            }
        } else if (choice === 'Open in a new window') {
            await this.openInNewWindow(path);
        } else if (choice === 'Start an AI CLI') {
            await this.startAiTool(path, basename(path));
        }
    }

    /**
     * Removal is a two-step refusal, on purpose. Git declines to remove a
     * worktree holding uncommitted or untracked work; overriding that discards
     * files that exist nowhere else, so it is asked for separately rather than
     * folded into the first confirmation.
     */
    private async removeWorktree(worktree: Worktree): Promise<void> {
        const action = {
            type: 'removeWorktree' as const,
            path: worktree.path,
            force: false,
        };

        if ((await this.deps.runner.confirm(action)) !== 'confirmed') {
            return;
        }

        const outcome = await this.deps.runner.attempt(action, {
            confirmed: true,
        });
        if (outcome.succeeded) {
            this.deps.runner.completed();
            return;
        }

        if (!looksDirty(outcome.message)) {
            await this.deps.runner.report(action, outcome);
            this.deps.runner.completed();
            return;
        }

        const forced = { ...action, force: true };
        const answer = await this.deps.runner.confirm(forced, {
            title: `${worktree.name} has uncommitted work. Remove it anyway?`,
            detail: `Git refused because the worktree contains modified or untracked files. Removing it deletes ${worktree.path} and everything in it that has not been committed.`,
            confirmLabel: 'Delete it anyway',
        });
        if (answer !== 'confirmed') {
            return;
        }

        const second = await this.deps.runner.attempt(forced, { confirmed: true });
        if (!second.succeeded) {
            await this.deps.runner.report(forced, second);
        }
        this.deps.runner.completed();
    }

    private async showHere(worktree: Worktree): Promise<void> {
        if (this.deps.showInGitHawk(worktree.path)) {
            return;
        }

        // Perhaps it appeared since the last scan.
        await this.deps.rescanRepositories();
        if (this.deps.showInGitHawk(worktree.path)) {
            return;
        }

        void vscode.window
            .showInformationMessage(
                `${worktree.name} is not one of the repositories GitHawk found, so it cannot be shown here.`,
                'Open in a new window'
            )
            .then((choice) => {
                if (choice === 'Open in a new window') {
                    void this.openInNewWindow(worktree.path);
                }
            });
    }

    private async openInNewWindow(path: string): Promise<void> {
        await vscode.commands.executeCommand(
            'vscode.openFolder',
            vscode.Uri.file(path),
            { forceNewWindow: true }
        );
    }

    /**
     * A terminal already rooted in the worktree. `cwd` is passed to VS Code
     * rather than sent as a `cd` command, so a path with spaces or quotes in it
     * is never interpreted by a shell.
     */
    private openTerminal(path: string, name: string): void {
        vscode.window
            .createTerminal({
                name,
                cwd: vscode.Uri.file(path),
                iconPath: new vscode.ThemeIcon('terminal'),
            })
            .show();
    }

    /** Same, then types the tool's command. */
    async startAiTool(
        path: string,
        name: string,
        tool?: AiTool
    ): Promise<void> {
        const chosen = tool ?? (await pickAiTool());
        if (!chosen) {
            return;
        }

        const terminal = vscode.window.createTerminal({
            name: `${chosen.name} — ${name}`,
            cwd: vscode.Uri.file(path),
            iconPath: new vscode.ThemeIcon('sparkle'),
        });
        terminal.show();
        // Only the configured command is sent; the directory came from `cwd`.
        // If the tool is not installed the shell says so, which is the clearest
        // report available and better than a dialog guessing at why.
        terminal.sendText(chosen.command);
        log.info(`started ${chosen.name} in ${path}`);
    }

    /** `GitHawk: Start AI CLI` — the current repository unless a worktree is picked. */
    async startAiToolHere(): Promise<void> {
        const worktrees = await this.deps.listWorktrees();
        const usable = worktrees.filter((worktree) => !worktree.isBare);

        if (usable.length <= 1) {
            const path = usable[0]?.path ?? this.deps.currentRepositoryPath();
            await this.startAiTool(path, basename(path));
            return;
        }

        const chosen = await vscode.window.showQuickPick(
            usable.map((worktree) => ({
                label: `${worktree.isCurrent ? '$(check)' : '$(folder)'} ${worktree.name}`,
                description: describeWorktree(worktree),
                detail: worktree.path,
                worktree,
            })),
            { title: 'Start an AI CLI', placeHolder: 'In which worktree?' }
        );

        if (chosen) {
            await this.startAiTool(chosen.worktree.path, chosen.worktree.name);
        }
    }

    /**
     * createQuickPick rather than showQuickPick, which cannot carry the
     * per-row buttons. Triggering one closes the picker: every button opens
     * something, so leaving the list up behind a new window or a terminal would
     * be in the way.
     */
    private pick(
        items: WorktreeItem[],
        options: { title: string; placeholder: string }
    ): Promise<WorktreeItem | undefined> {
        const quickPick = vscode.window.createQuickPick<WorktreeItem>();
        quickPick.title = options.title;
        quickPick.placeholder = options.placeholder;
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.items = items;

        return new Promise<WorktreeItem | undefined>((resolve) => {
            let settled = false;
            const close = (chosen?: WorktreeItem) => {
                if (settled) {
                    return;
                }
                settled = true;
                quickPick.dispose();
                resolve(chosen);
            };

            quickPick.onDidTriggerItemButton(async (event) => {
                const worktree = event.item.worktree;
                close();
                if (!worktree) {
                    return;
                }
                if (event.button === NEW_WINDOW_BUTTON) {
                    await this.openInNewWindow(worktree.path);
                } else if (event.button === TERMINAL_BUTTON) {
                    this.openTerminal(worktree.path, worktree.name);
                } else if (event.button === AI_BUTTON) {
                    await this.startAiTool(worktree.path, worktree.name);
                }
            });
            quickPick.onDidAccept(() => close(quickPick.selectedItems[0]));
            quickPick.onDidHide(() => close());
            quickPick.show();
        });
    }

    /** See gitHawk.worktreeItems: structure only, nothing shown. */
    async managerItemsForTesting(): Promise<{
        labels: string[];
        details: string[];
        buttonCounts: number[];
    }> {
        const worktrees = await this.deps.listWorktrees();
        const stale = prunableWorktrees(worktrees);

        const labels = worktrees.map(
            (worktree) =>
                `${worktree.isCurrent ? '$(check)' : '$(folder)'} ${worktree.name}`
        );
        labels.push('$(new-folder) Create a worktree…');
        if (stale.length > 0) {
            labels.push(`$(trash) Prune ${stale.length} stale record(s)`);
        }

        return {
            labels,
            details: worktrees.map((worktree) => worktree.path),
            buttonCounts: worktrees.map((worktree) =>
                worktree.isPrunable ? 0 : 3
            ),
        };
    }
}

async function pickAiTool(): Promise<AiTool | undefined> {
    const tools = aiTools();

    const chosen = await vscode.window.showQuickPick(
        tools.map((tool) => ({
            label: `$(sparkle) ${tool.name}`,
            description: tool.command,
            tool,
        })),
        {
            title: 'Start an AI CLI',
            placeHolder: 'Which one?',
            matchOnDescription: true,
        }
    );

    return chosen?.tool;
}

function describeWorktree(worktree: Worktree): string {
    const parts = [worktree.checkedOut];

    if (worktree.isMain) {
        parts.push('main worktree');
    }
    if (worktree.isLocked) {
        parts.push(worktree.lockReason ? `locked: ${worktree.lockReason}` : 'locked');
    }
    if (worktree.isPrunable) {
        // The most important thing to say: the directory is gone, and until this
        // record is pruned git keeps refusing to check the branch out anywhere.
        parts.push('directory missing');
    }

    return parts.join(' · ');
}

/** Git's refusal when a worktree holds work that removing it would destroy. */
function looksDirty(message: string | undefined): boolean {
    return /contains modified or untracked files|is dirty|use --force/i.test(
        message ?? ''
    );
}

function basename(path: string): string {
    const segments = path.replace(/[\\/]+$/, '').split(/[\\/]/);
    return segments[segments.length - 1] || path;
}
