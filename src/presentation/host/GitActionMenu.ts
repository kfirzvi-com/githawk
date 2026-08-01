import * as vscode from 'vscode';
import { GitAction } from '../../domain/models/GitAction';
import { IGitWriter } from '../../domain/repositories/IGitWriter';
import { ActionRunner } from './ActionRunner';

export interface CommitContext {
    hash: string;
    shortHash: string;
    subject: string;
    branchNames: string[];
    tagNames: string[];
}

/** What the menu asks for; resolving and running it belongs elsewhere. */
export type CompareRequest =
    | { kind: 'ownChanges'; hash: string }
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
    /**
     * Set when the branch is checked out in a *different* working tree. Git will
     * refuse to check it out again, so the menu offers that worktree instead.
     */
    checkedOutIn?: { path: string; name: string };
    /**
     * The repository's remotes, for publishing a branch that tracks nothing.
     * Named rather than assumed to be `origin`: a fork checkout often has two,
     * and pushing a new branch to the wrong one is not obvious afterwards.
     */
    remoteNames: string[];
}

/** What the menu asks the worktree UI to do; the doing belongs elsewhere. */
export type WorktreeRequest =
    | { kind: 'open'; path: string }
    | { kind: 'createForBranch'; branch: string };

/** A menu as a test can read it: what it offers, and how it is grouped. */
export interface MenuEntries {
    separators: string[];
    labels: string[];
    entries: { label: string; description?: string }[];
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
    private readonly runner: ActionRunner;

    constructor(
        writer: IGitWriter,
        onCompleted: () => void,
        /** Comparisons are owned by ComparisonController; the menu only asks. */
        private readonly onCompareRequested?: (
            request: CompareRequest
        ) => Promise<void>,
        /** Worktrees are owned by WorktreeMenu; the menu only asks. */
        private readonly onWorktreeRequested?: (
            request: WorktreeRequest
        ) => Promise<void>
    ) {
        this.runner = new ActionRunner(writer, onCompleted);
    }

    async showForCommit(commit: CommitContext): Promise<void> {
        const compare: ActionItem[] = [
            /*
             * Selecting a commit already fills the Changes tree, but only shows
             * it the first time — pulling focus to the sidebar on every click
             * would make the graph unbrowsable. That leaves no way to ask for it
             * deliberately once the view has been closed or covered, which is
             * what this entry is.
             */
            {
                label: '$(list-tree) Show changes in the sidebar',
                description: `${commit.shortHash} — the files this commit changed`,
                build: async () => {
                    await this.onCompareRequested?.({
                        kind: 'ownChanges',
                        hash: commit.hash,
                    });
                    return undefined;
                },
            },
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
        const sync = this.syncEntries(branch);

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
        } else if (!branch.isCurrent && !branch.checkedOutIn) {
            checkout.push({
                label: `$(check) Check out ${branch.name}`,
                build: async () => ({ type: 'checkoutBranch', name: branch.name }),
            });
        }

        /*
         * A branch lives in one working tree at a time. When another has it, an
         * ordinary checkout is refused, and git's error names a path without
         * explaining the rule — so the entry is replaced rather than left to
         * fail. Creating a worktree is offered either way: it is the way to work
         * on a branch without disturbing what is checked out here.
         */
        const worktrees: ActionItem[] = [];
        if (branch.checkedOutIn) {
            worktrees.push({
                label: `$(multiple-windows) Open the worktree ${branch.checkedOutIn.name}`,
                description: 'this branch is checked out there',
                detail: branch.checkedOutIn.path,
                build: async () => {
                    await this.onWorktreeRequested?.({
                        kind: 'open',
                        path: branch.checkedOutIn!.path,
                    });
                    return undefined;
                },
            });
        } else if (!branch.isRemote) {
            worktrees.push({
                label: `$(new-folder) Create a worktree for ${branch.name}…`,
                description: 'work on it without changing this checkout',
                build: async () => {
                    await this.onWorktreeRequested?.({
                        kind: 'createForBranch',
                        branch: branch.name,
                    });
                    return undefined;
                },
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

        /*
         * A commit can copy its hash; a branch could not copy its name — and a
         * branch name is the thing people actually retype, into a checkout, a
         * PR description, a CI filter. Selecting it out of the graph is not an
         * option: the panel is a webview, and the branch list renders it inside
         * a button.
         */
        const clipboard: ActionItem[] = [
            {
                label: '$(clippy) Copy branch name',
                description: branch.name,
                build: async () => {
                    await vscode.env.clipboard.writeText(branch.name);
                    vscode.window.setStatusBarMessage(
                        `Copied ${branch.name}`,
                        3000
                    );
                    return undefined;
                },
            },
        ];

        const items = [
            ...group('Sync', sync),
            ...group('Compare', compare),
            ...group('Check out', checkout),
            ...group('Worktree', worktrees),
            ...group('Bring into current branch', integrate),
            ...group('Copy', clipboard),
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
     * Push and pull for one named branch, and the two states in which neither
     * is the right answer.
     *
     * One group rather than an entry that appears only when there is something
     * to do: "where is push?" should have the same answer every time the menu
     * opens, and whether it will move anything belongs in the description. The
     * counts are read from the repository by the caller, not from the webview,
     * because they go stale the moment anything fetches.
     */
    private syncEntries(branch: BranchContext): ActionItem[] {
        // A remote-tracking ref is a local mirror of someone else's branch;
        // pushing or pulling it is not a thing you can do.
        if (branch.isRemote) {
            return [];
        }

        const upstream = branch.upstream;
        const entries: ActionItem[] = [];

        if (upstream?.isGone) {
            entries.push({
                label: `$(warning) ${upstream.name} no longer exists`,
                description: 'the remote branch was deleted',
                build: async () => undefined,
            });
        } else if (upstream?.hasDiverged) {
            entries.push(this.divergedEntry(branch, upstream));
        } else if (upstream) {
            entries.push({
                label: `$(cloud-download) Pull ${branch.name} from ${upstream.name}`,
                description: describePull(upstream.behind, branch.isCurrent),
                build: async () =>
                    branch.isCurrent
                        ? {
                              type: 'pullBranch',
                              remote: remoteOf(upstream.name),
                              branch: remoteBranchOf(upstream.name),
                          }
                        : /*
                           * git refuses a refspec fetch into the checked-out
                           * branch, and refuses to pull into one that is not
                           * checked out — so the same intent is two different
                           * commands depending on where HEAD is.
                           */
                          {
                              type: 'updateBranchFromUpstream',
                              branch: branch.name,
                              remote: remoteOf(upstream.name),
                              remoteBranch: remoteBranchOf(upstream.name),
                          },
            });
        }

        entries.push(this.pushEntry(branch));
        return entries;
    }

    private pushEntry(branch: BranchContext): ActionItem {
        const upstream = branch.upstream;
        const published = upstream !== undefined && !upstream.isGone;

        if (published) {
            return {
                label: `$(cloud-upload) Push ${branch.name} to ${remoteOf(upstream.name)}`,
                description: describePush(upstream),
                build: async () => ({
                    type: 'pushBranch',
                    remote: remoteOf(upstream.name),
                    branch: branch.name,
                    setUpstream: false,
                }),
            };
        }

        return {
            label: `$(cloud-upload) Publish ${branch.name}…`,
            description:
                upstream?.isGone === true
                    ? 'recreates the branch on the remote'
                    : 'this branch exists only here',
            build: async () => {
                const remote = await this.pickRemote(branch.remoteNames);
                return remote
                    ? {
                          type: 'pushBranch',
                          remote,
                          branch: branch.name,
                          // The point of a first push: without it the branch is
                          // pushed and still tracks nothing, so every later
                          // push needs naming again.
                          setUpstream: true,
                      }
                    : undefined;
            },
        };
    }

    /** No prompt for the overwhelmingly common single-remote case. */
    private async pickRemote(names: string[]): Promise<string | undefined> {
        if (names.length === 0) {
            vscode.window.showWarningMessage(
                'This repository has no remotes. Add one first — GitHawk: Manage Remotes.'
            );
            return undefined;
        }
        if (names.length === 1) {
            return names[0];
        }
        return vscode.window.showQuickPick(names, {
            title: 'Publish to which remote?',
        });
    }

    private divergedEntry(
        branch: BranchContext,
        upstream: NonNullable<BranchContext['upstream']>
    ): ActionItem {
        return {
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
        };
    }

    /**
     * The menu entries for a branch, without showing anything. Exposed so the
     * integration tests can assert the grouping — a QuickPick cannot be inspected
     * once it is on screen.
     */
    async entriesForBranch(branch: BranchContext): Promise<MenuEntries> {
        return this.capture(() => this.showForBranch(branch));
    }

    /** See entriesForBranch. */
    async entriesForCommit(commit: CommitContext): Promise<MenuEntries> {
        return this.capture(() => this.showForCommit(commit));
    }

    /**
     * Runs the real construction with the presentation swapped out, so a test
     * reads exactly the menu a user would get. Rebuilding the items here instead
     * is how a missing feature once tested green.
     */
    private async capture(build: () => Promise<void>): Promise<MenuEntries> {
        const captured: ActionItem[] = [];
        const original = this.show.bind(this);
        this.show = async (items: ActionItem[]) => {
            captured.push(...items);
        };
        try {
            await build();
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
        await this.runner.run({ type });
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
            await this.runner.run(action);
        }
    };
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

function describePull(behind: number, isCurrent: boolean): string {
    if (behind === 0) {
        return 'already up to date';
    }
    return isCurrent
        ? `${behind} behind`
        : `${behind} behind — fast-forward, no checkout`;
}

function describePush(upstream: NonNullable<BranchContext['upstream']>): string {
    return upstream.ahead === 0
        ? 'nothing to push'
        : `${upstream.ahead} commit(s) the remote does not have`;
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
