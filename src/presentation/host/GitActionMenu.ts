import * as vscode from 'vscode';
import {
    GitAction,
    destructiveReason,
    isDestructive,
} from '../../domain/models/GitAction';
import { PerformGitActionUseCase } from '../../application/usecases/PerformGitActionUseCase';
import { IGitWriter } from '../../domain/repositories/IGitWriter';

export interface CommitContext {
    hash: string;
    shortHash: string;
    subject: string;
    branchNames: string[];
    tagNames: string[];
}

export interface BranchContext {
    name: string;
    isRemote: boolean;
    isCurrent: boolean;
}

interface ActionItem extends vscode.QuickPickItem {
    /** Resolved lazily, so prompts only appear once the item is chosen. */
    build: () => Promise<GitAction | undefined>;
}

/**
 * Presents git actions through VS Code's own QuickPick and modal dialogs rather
 * than a menu drawn inside the webview.
 *
 * Deliberate: native menus bring keyboard navigation, correct theming, and a
 * confirmation dialog users already recognise. A custom in-webview context menu
 * would need all of that rebuilding, and a home-made confirmation is exactly the
 * thing people learn to click through.
 */
export class GitActionMenu {
    private readonly performAction: PerformGitActionUseCase;

    constructor(
        writer: IGitWriter,
        private readonly onCompleted: () => void
    ) {
        this.performAction = new PerformGitActionUseCase(writer);
    }

    async showForCommit(commit: CommitContext): Promise<void> {
        const items: ActionItem[] = [
            {
                label: '$(git-branch) Create branch here…',
                build: async () => {
                    const name = await promptForName(
                        'New branch name',
                        `Branch at ${commit.shortHash}`
                    );
                    return name
                        ? { type: 'createBranch', name, at: commit.hash, checkout: true }
                        : undefined;
                },
            },
            {
                label: '$(tag) Create tag here…',
                build: async () => {
                    const name = await promptForName(
                        'New tag name',
                        `Tag at ${commit.shortHash}`
                    );
                    return name
                        ? { type: 'createTag', name, at: commit.hash }
                        : undefined;
                },
            },
            {
                label: '$(git-commit) Check out this commit',
                description: 'detaches HEAD',
                build: async () => ({ type: 'checkoutCommit', hash: commit.hash }),
            },
            {
                label: '$(diff-added) Cherry-pick onto current branch',
                build: async () => ({ type: 'cherryPick', hash: commit.hash }),
            },
            {
                label: '$(discard) Revert this commit',
                description: 'adds a commit undoing it',
                build: async () => ({ type: 'revert', hash: commit.hash }),
            },
            {
                label: '$(history) Reset current branch to here…',
                description: 'soft, mixed, or hard',
                build: () => pickResetMode(commit.hash),
            },
            {
                label: '$(clippy) Copy commit hash',
                build: async () => {
                    await vscode.env.clipboard.writeText(commit.hash);
                    vscode.window.setStatusBarMessage(
                        `Copied ${commit.shortHash}`,
                        3000
                    );
                    return undefined;
                },
            },
        ];

        for (const tag of commit.tagNames) {
            items.push({
                label: `$(trash) Delete tag ${tag}`,
                build: async () => ({ type: 'deleteTag', name: tag }),
            });
        }

        await this.show(
            items,
            `${commit.shortHash} — ${truncate(commit.subject, 60)}`
        );
    }

    async showForBranch(branch: BranchContext): Promise<void> {
        const items: ActionItem[] = [];

        if (branch.isRemote) {
            const localName = stripRemote(branch.name);
            items.push({
                label: `$(cloud-download) Check out ${localName} tracking this remote`,
                build: async () => ({
                    type: 'checkoutRemote',
                    remoteBranch: branch.name,
                    localName,
                }),
            });
        } else if (!branch.isCurrent) {
            items.push({
                label: `$(check) Check out ${branch.name}`,
                build: async () => ({ type: 'checkoutBranch', name: branch.name }),
            });
        }

        if (!branch.isCurrent) {
            items.push(
                {
                    label: `$(git-merge) Merge ${branch.name} into current branch`,
                    build: async () => ({
                        type: 'mergeBranch',
                        name: branch.name,
                        noFastForward: true,
                    }),
                },
                {
                    label: `$(git-pull-request) Rebase current branch onto ${branch.name}`,
                    description: 'rewrites history',
                    build: async () => ({ type: 'rebaseOnto', name: branch.name }),
                }
            );
        }

        if (!branch.isRemote && !branch.isCurrent) {
            items.push({
                label: `$(trash) Delete ${branch.name}`,
                build: async () => ({
                    type: 'deleteBranch',
                    name: branch.name,
                    force: false,
                }),
            });
        }

        if (items.length === 0) {
            vscode.window.showInformationMessage(
                `${branch.name} is already checked out.`
            );
            return;
        }

        await this.show(items, branch.name);
    }

    /** Toolbar operations, which need no target. */
    async runRemoteOperation(type: 'fetch' | 'pull' | 'push'): Promise<void> {
        await this.run({ type });
    }

    private async show(items: ActionItem[], title: string): Promise<void> {
        const chosen = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: 'Choose an action',
            matchOnDescription: true,
        });
        if (!chosen) {
            return;
        }

        const action = await chosen.build();
        if (action) {
            await this.run(action);
        }
    }

    private async run(action: GitAction): Promise<void> {
        let confirmed = false;

        if (isDestructive(action)) {
            const reason = destructiveReason(action);
            const answer = await vscode.window.showWarningMessage(
                `${describe(action)}?`,
                {
                    modal: true,
                    detail: reason
                        ? `This ${reason}. It cannot always be undone.`
                        : undefined,
                },
                'Yes, continue'
            );
            if (answer !== 'Yes, continue') {
                return;
            }
            confirmed = true;
        }

        const outcome = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: describe(action) },
            () => this.performAction.execute(action, { confirmed })
        );

        if (outcome.succeeded) {
            this.onCompleted();
            return;
        }

        // git's own wording is the most useful thing available here.
        const retry = await vscode.window.showErrorMessage(
            `${describe(action)} failed`,
            { detail: outcome.message, modal: false },
            'Show details'
        );
        if (retry === 'Show details') {
            const channel = vscode.window.createOutputChannel('GitHawk');
            channel.appendLine(`$ git ${action.type}`);
            channel.appendLine(outcome.message ?? 'no output');
            channel.show();
        }

        // The repository may have changed even on failure — a merge can conflict
        // halfway — so the graph is refreshed either way.
        this.onCompleted();
    }
}

function describe(action: GitAction): string {
    switch (action.type) {
        case 'checkoutBranch':
            return `Check out ${action.name}`;
        case 'checkoutCommit':
            return `Check out ${action.hash.slice(0, 8)}`;
        case 'checkoutRemote':
            return `Check out ${action.localName}`;
        case 'createBranch':
            return `Create branch ${action.name}`;
        case 'deleteBranch':
            return `Delete branch ${action.name}`;
        case 'createTag':
            return `Create tag ${action.name}`;
        case 'deleteTag':
            return `Delete tag ${action.name}`;
        case 'mergeBranch':
            return `Merge ${action.name}`;
        case 'rebaseOnto':
            return `Rebase onto ${action.name}`;
        case 'cherryPick':
            return `Cherry-pick ${action.hash.slice(0, 8)}`;
        case 'revert':
            return `Revert ${action.hash.slice(0, 8)}`;
        case 'reset':
            return `Reset --${action.mode} to ${action.hash.slice(0, 8)}`;
        case 'fetch':
            return 'Fetch';
        case 'pull':
            return 'Pull';
        case 'push':
            return 'Push';
    }
}

async function pickResetMode(hash: string): Promise<GitAction | undefined> {
    const chosen = await vscode.window.showQuickPick(
        [
            {
                label: 'Soft',
                description: 'keep the working tree and the index',
                mode: 'soft' as const,
            },
            {
                label: 'Mixed',
                description: 'keep files, unstage changes',
                mode: 'mixed' as const,
            },
            {
                label: 'Hard',
                description: 'discard all uncommitted changes',
                mode: 'hard' as const,
            },
        ],
        { title: 'Reset mode', placeHolder: 'How much should be discarded?' }
    );

    return chosen ? { type: 'reset', hash, mode: chosen.mode } : undefined;
}

async function promptForName(
    prompt: string,
    placeHolder: string
): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
        prompt,
        placeHolder,
        validateInput: (input) => {
            const trimmed = input.trim();
            if (trimmed.length === 0) {
                return 'A name is required';
            }
            // Mirrors git check-ref-format so the failure is caught before git.
            if (/[\s~^:?*[\\]/.test(trimmed)) {
                return 'A ref name cannot contain spaces or any of ~ ^ : ? * [ \\';
            }
            if (trimmed.includes('..') || trimmed.endsWith('.lock')) {
                return 'A ref name cannot contain ".." or end with ".lock"';
            }
            if (trimmed.startsWith('-')) {
                return 'A ref name cannot start with "-"';
            }
            return undefined;
        },
    });

    return value?.trim() || undefined;
}

function stripRemote(remoteBranch: string): string {
    const slash = remoteBranch.indexOf('/');
    return slash >= 0 ? remoteBranch.slice(slash + 1) : remoteBranch;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
