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

/** What the menu asks for; resolving and running it belongs elsewhere. */
export type CompareRequest =
    | { kind: 'myWorkAgainst'; base: string }
    | { kind: 'pickAgainst'; left: string; leftLabel: string }
    | { kind: 'againstWorkingTree'; left: string; leftLabel: string };

export interface BranchContext {
    name: string;
    isRemote: boolean;
    isCurrent: boolean;
    /** Resolved by the host from the repository, not trusted from the webview. */
    upstream?: {
        name: string;
        ahead: number;
        behind: number;
        isGone: boolean;
        canFastForward: boolean;
        hasDiverged: boolean;
    };
}

interface ActionItem extends vscode.QuickPickItem {
    /**
     * Resolved lazily, so prompts only appear once the item is chosen. Absent on
     * separators, which VS Code renders but does not allow selecting.
     */
    build?: () => Promise<GitAction | undefined>;
}

/**
 * Groups the menu by topic. These lists grew past the point where a flat one is
 * scannable — the commit menu alone has nine entries spanning comparison,
 * branching, tagging, applying elsewhere, and history rewriting — and a reader
 * hunting for "revert" should not have to read past "create tag".
 *
 * Empty groups drop their heading rather than leaving a stray separator, since
 * which entries apply depends on the branch and the commit.
 */
function group(label: string, items: ActionItem[]): ActionItem[] {
    if (items.length === 0) {
        return [];
    }
    return [
        { label, kind: vscode.QuickPickItemKind.Separator },
        ...items,
    ];
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
        private readonly onCompleted: () => void,
        /** Comparisons are owned by ComparisonController; the menu only asks. */
        private readonly onCompareRequested?: (
            request: CompareRequest
        ) => Promise<void>
    ) {
        this.performAction = new PerformGitActionUseCase(writer);
    }

    async showForCommit(commit: CommitContext): Promise<void> {
        const compare: ActionItem[] = [
            {
                label: '$(diff) Compare with…',
                description: 'another branch, tag, or commit',
                build: async () => {
                    await this.onCompareRequested?.({
                        kind: 'pickAgainst',
                        left: commit.hash,
                        leftLabel: commit.shortHash,
                    });
                    return undefined;
                },
            },
            {
                label: '$(git-compare) Compare with my working tree',
                build: async () => {
                    await this.onCompareRequested?.({
                        kind: 'againstWorkingTree',
                        left: commit.hash,
                        leftLabel: commit.shortHash,
                    });
                    return undefined;
                },
            },
        ];

        const branches: ActionItem[] = [
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
                label: '$(git-commit) Check out this commit',
                description: 'detaches HEAD',
                build: async () => ({ type: 'checkoutCommit', hash: commit.hash }),
            },
        ];

        const tags: ActionItem[] = [
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
            ...commit.tagNames.map((tag) => ({
                label: `$(trash) Delete tag ${tag}`,
                build: async () => ({ type: 'deleteTag' as const, name: tag }),
            })),
        ];

        // Grouped apart from the tag and branch entries because these three
        // change the current branch's history rather than adding a label to this
        // commit — a distinction worth making before someone picks one.
        const applyElsewhere: ActionItem[] = [
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
        ];

        const clipboard: ActionItem[] = [
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

        await this.show(
            [
                ...group('Compare', compare),
                ...group('Branch', branches),
                ...group('Tag', tags),
                ...group('Apply to current branch', applyElsewhere),
                ...group('Copy', clipboard),
            ],
            `${commit.shortHash} — ${truncate(commit.subject, 60)}`
        );
    }

    async showForBranch(branch: BranchContext): Promise<void> {
        const upstream = branch.upstream;

        // Updating comes first: it is the most frequent reason to open this menu,
        // and the counts are the answer to "does this branch need anything?".
        const update: ActionItem[] = [];
        if (upstream && !branch.isRemote) {
            if (upstream.canFastForward && !branch.isCurrent) {
                update.push({
                    label: `$(cloud-download) Update from ${upstream.name}`,
                    description: `${upstream.behind} behind — fast-forward, no checkout`,
                    build: async () => ({
                        type: 'updateBranchFromUpstream',
                        branch: branch.name,
                        remote: remoteOf(upstream.name),
                        remoteBranch: remoteBranchOf(upstream.name),
                    }),
                });
            } else if (branch.isCurrent && upstream.behind > 0) {
                update.push({
                    label: `$(cloud-download) Pull ${upstream.behind} commit(s) from ${upstream.name}`,
                    // git refuses a refspec fetch into the current branch, so the
                    // same intent has to be expressed as a pull.
                    description: 'this branch is checked out, so it is a pull',
                    build: async () => ({ type: 'pull' }),
                });
            } else if (upstream.hasDiverged) {
                update.push({
                    label: `$(warning) Diverged from ${upstream.name}`,
                    description: `${upstream.ahead} ahead, ${upstream.behind} behind`,
                    build: async () => {
                        // Choosing between a merge and a rebase is the user's call.
                        const choice = await vscode.window.showWarningMessage(
                            `${branch.name} and ${upstream.name} have both moved on.`,
                            {
                                modal: true,
                                detail: `${branch.name} has ${upstream.ahead} commit(s) the remote does not, and ${upstream.behind} the other way. It cannot be advanced without merging or rebasing, which needs it checked out.`,
                            },
                            `Check out ${branch.name}`
                        );
                        return choice
                            ? { type: 'checkoutBranch', name: branch.name }
                            : undefined;
                    },
                });
            } else if (upstream.isGone) {
                update.push({
                    label: `$(warning) ${upstream.name} no longer exists`,
                    description: 'the remote branch was deleted',
                    build: async () => undefined,
                });
            }
        }

        const compare: ActionItem[] = [];
        if (!branch.isCurrent) {
            compare.push({
                label: `$(diff) Review my work against ${branch.name}`,
                description: 'from where the branches diverged',
                build: async () => {
                    await this.onCompareRequested?.({
                        kind: 'myWorkAgainst',
                        base: branch.name,
                    });
                    return undefined;
                },
            });
        }
        compare.push({
            label: `$(git-compare) Compare ${branch.name} with…`,
            description: 'any other branch, tag, or commit',
            build: async () => {
                await this.onCompareRequested?.({
                    kind: 'pickAgainst',
                    left: branch.name,
                    leftLabel: branch.name,
                });
                return undefined;
            },
        });

        const checkout: ActionItem[] = [];
        if (branch.isRemote) {
            const localName = stripRemote(branch.name);
            checkout.push({
                label: `$(cloud-download) Check out ${localName} tracking this remote`,
                build: async () => ({
                    type: 'checkoutRemote',
                    remoteBranch: branch.name,
                    localName,
                }),
            });
        } else if (!branch.isCurrent) {
            checkout.push({
                label: `$(check) Check out ${branch.name}`,
                build: async () => ({ type: 'checkoutBranch', name: branch.name }),
            });
        }

        // Both of these bring another branch's commits into the one you are on,
        // which is a different kind of act from navigating or comparing.
        const integrate: ActionItem[] = [];
        if (!branch.isCurrent) {
            integrate.push(
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

        const manage: ActionItem[] = [];
        if (!branch.isRemote) {
            manage.push({
                label: `$(edit) Rename ${branch.name}…`,
                build: async () => {
                    const to = await promptForName(
                        `New name for ${branch.name}`,
                        branch.name,
                        branch.name
                    );
                    return to && to !== branch.name
                        ? { type: 'renameBranch', from: branch.name, to }
                        : undefined;
                },
            });
        }
        if (!branch.isRemote && !branch.isCurrent) {
            manage.push({
                label: `$(trash) Delete ${branch.name}`,
                build: async () => ({
                    type: 'deleteBranch',
                    name: branch.name,
                    force: false,
                }),
            });
        }
        if (branch.isRemote) {
            manage.push({
                label: `$(trash) Delete ${branch.name} on the remote`,
                description: 'affects everyone, not just you',
                build: async () => ({
                    type: 'deleteRemoteBranch',
                    remote: remoteOf(branch.name),
                    branch: remoteBranchOf(branch.name),
                }),
            });
        }

        const items = [
            ...group('Update', update),
            ...group('Compare', compare),
            ...group('Check out', checkout),
            ...group('Bring into current branch', integrate),
            ...group('Manage', manage),
        ];

        if (items.length === 0) {
            vscode.window.showInformationMessage(
                `${branch.name} has no available actions.`
            );
            return;
        }

        await this.show(items, branch.name);
    }

    /**
     * The menu entries for a branch, without showing anything. Exposed so the
     * integration tests can assert the grouping — a QuickPick cannot be inspected
     * once it is on screen.
     */
    async entriesForBranch(branch: BranchContext): Promise<{
        separators: string[];
        labels: string[];
        entries: { label: string; description?: string }[];
    }> {
        const captured: ActionItem[] = [];
        const original = this.show.bind(this);
        // Intercept rather than duplicate the construction, so the test sees
        // exactly what a user would.
        this.show = async (items: ActionItem[]) => {
            captured.push(...items);
        };
        try {
            await this.showForBranch(branch);
        } finally {
            this.show = original;
        }

        const actions = captured.filter(
            (i) => i.kind !== vscode.QuickPickItemKind.Separator
        );

        return {
            separators: captured
                .filter((i) => i.kind === vscode.QuickPickItemKind.Separator)
                .map((i) => i.label),
            labels: actions.map((i) => i.label),
            entries: actions.map((i) => ({
                label: i.label,
                description: i.description,
            })),
        };
    }

    /** Toolbar operations, which need no target. */
    async runRemoteOperation(type: 'fetch' | 'pull' | 'push'): Promise<void> {
        await this.run({ type });
    }

    private show = async (items: ActionItem[], title?: string): Promise<void> => {
        const chosen = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: 'Choose an action',
            matchOnDescription: true,
        });
        if (!chosen) {
            return;
        }

        // A separator cannot be picked, so this is unreachable in practice; the
        // check exists because the type permits it.
        const action = await chosen.build?.();
        if (action) {
            await this.run(action);
        }
    };

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
        case 'updateBranchFromUpstream':
            return `Update ${action.branch} from ${action.remote}/${action.remoteBranch}`;
        case 'deleteRemoteBranch':
            return `Delete ${action.branch} on ${action.remote}`;
        case 'renameBranch':
            return `Rename ${action.from} to ${action.to}`;
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
    placeHolder: string,
    value?: string
): Promise<string | undefined> {
    const entered = await vscode.window.showInputBox({
        prompt,
        placeHolder,
        value,
        // Pre-selects the last path segment, so renaming feature/old-name only
        // requires typing the part that changes.
        valueSelection: value
            ? [(value.lastIndexOf('/') + 1), value.length]
            : undefined,
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

    return entered?.trim() || undefined;
}

/** `origin/feature/x` → `origin`. Remote names cannot contain a slash. */
function remoteOf(upstreamName: string): string {
    const slash = upstreamName.indexOf('/');
    return slash >= 0 ? upstreamName.slice(0, slash) : 'origin';
}

/** `origin/feature/x` → `feature/x`. */
function remoteBranchOf(upstreamName: string): string {
    const slash = upstreamName.indexOf('/');
    return slash >= 0 ? upstreamName.slice(slash + 1) : upstreamName;
}

function stripRemote(remoteBranch: string): string {
    const slash = remoteBranch.indexOf('/');
    return slash >= 0 ? remoteBranch.slice(slash + 1) : remoteBranch;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
