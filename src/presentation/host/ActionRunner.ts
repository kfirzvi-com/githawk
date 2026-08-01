import * as vscode from 'vscode';
import {
    GitAction,
    destructiveReason,
    isDestructive,
} from '../../domain/models/GitAction';
import {
    ActionOutcome,
    PerformGitActionUseCase,
} from '../../application/usecases/PerformGitActionUseCase';
import { IGitWriter } from '../../domain/repositories/IGitWriter';
import { log } from './log';

/**
 * Confirms, runs, and reports a git action.
 *
 * Shared by every menu rather than reimplemented per menu, because the
 * confirmation rule is the safety property: `PerformGitActionUseCase` refuses a
 * destructive action that was not confirmed, and a second menu with its own
 * ad-hoc dialog is how that guarantee quietly stops holding.
 *
 * The three steps are also exposed separately, for the one flow that needs to
 * see a failure before deciding what to do about it — removing a worktree that
 * git refuses because it is dirty.
 */
export class ActionRunner {
    private readonly performAction: PerformGitActionUseCase;

    constructor(
        writer: IGitWriter,
        private readonly onCompleted: () => void
    ) {
        this.performAction = new PerformGitActionUseCase(writer);
    }

    /** Confirm if needed, run, report on failure. The usual path. */
    async run(action: GitAction): Promise<boolean> {
        const confirmed = await this.confirm(action);
        if (confirmed === 'declined') {
            return false;
        }

        const outcome = await this.attempt(action, {
            confirmed: confirmed === 'confirmed',
        });

        if (!outcome.succeeded) {
            await this.report(action, outcome);
        }

        // The repository may have changed even on failure — a merge can
        // conflict halfway — so the graph is refreshed either way.
        this.onCompleted();
        return outcome.succeeded;
    }

    /**
     * `not-needed` for an action that is not destructive, so a caller cannot
     * accidentally treat "no dialog was shown" as "the user said no".
     */
    async confirm(
        action: GitAction,
        override?: { title: string; detail: string; confirmLabel: string }
    ): Promise<'confirmed' | 'declined' | 'not-needed'> {
        if (!override && !isDestructive(action)) {
            return 'not-needed';
        }

        const reason = destructiveReason(action);
        const answer = await vscode.window.showWarningMessage(
            override?.title ?? `${describe(action)}?`,
            {
                modal: true,
                detail:
                    override?.detail ??
                    (reason
                        ? `This ${reason}. It cannot always be undone.`
                        : undefined),
            },
            override?.confirmLabel ?? 'Yes, continue'
        );

        return answer === (override?.confirmLabel ?? 'Yes, continue')
            ? 'confirmed'
            : 'declined';
    }

    /** Runs without confirming or reporting, so the caller can do both. */
    async attempt(
        action: GitAction,
        options: { confirmed: boolean }
    ): Promise<ActionOutcome> {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: describe(action),
            },
            () => this.performAction.execute(action, options)
        );
    }

    async report(action: GitAction, outcome: ActionOutcome): Promise<void> {
        log.warn(`${describe(action)} failed: ${outcome.message ?? 'no output'}`);

        // git's own wording is the most useful thing available here.
        const choice = await vscode.window.showErrorMessage(
            `${describe(action)} failed`,
            { detail: outcome.message, modal: false },
            'Show log'
        );
        if (choice === 'Show log') {
            log.show();
        }
    }

    completed(): void {
        this.onCompleted();
    }
}

export function describe(action: GitAction): string {
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
        case 'pushBranch':
            return action.setUpstream
                ? `Publish ${action.branch} to ${action.remote}`
                : `Push ${action.branch} to ${action.remote}`;
        case 'pullBranch':
            return `Pull ${action.branch} from ${action.remote}`;
        case 'addRemote':
            return `Add remote ${action.name}`;
        case 'renameRemote':
            return `Rename remote ${action.from} to ${action.to}`;
        case 'removeRemote':
            return `Remove remote ${action.name}`;
        case 'setRemoteUrl':
            return `Change the URL of ${action.name}`;
        case 'fetchRemote':
            return `Fetch ${action.name}`;
        case 'pruneRemote':
            return `Prune ${action.name}`;
        case 'updateBranchFromUpstream':
            return `Update ${action.branch} from ${action.remote}/${action.remoteBranch}`;
        case 'deleteRemoteBranch':
            return `Delete ${action.branch} on ${action.remote}`;
        case 'renameBranch':
            return `Rename ${action.from} to ${action.to}`;
        case 'addWorktree':
            return action.newBranch
                ? `Create worktree for new branch ${action.newBranch}`
                : `Create worktree for ${action.ref}`;
        case 'removeWorktree':
            return `Remove worktree ${action.path}`;
        case 'pruneWorktrees':
            return 'Prune stale worktree records';
        case 'lockWorktree':
            return `Lock worktree ${action.path}`;
        case 'unlockWorktree':
            return `Unlock worktree ${action.path}`;
    }
}
