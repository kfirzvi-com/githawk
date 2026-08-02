import { GitAction } from '../../domain/models/GitAction';

/**
 * Maps an intent to git arguments. Pure, so every mapping is asserted in tests —
 * this is the file where a wrong flag costs someone their working tree.
 *
 * Arguments are always returned as an array and handed to execFile, never joined
 * into a shell string. Branch and tag names come from a repository and from user
 * input, so they must never be interpreted by a shell.
 *
 * `--` terminators are used where git accepts them, so a ref named like a flag
 * cannot be read as one.
 */
export function argsFor(action: GitAction): string[] {
    switch (action.type) {
        case 'checkoutBranch':
            return ['checkout', action.name];

        case 'checkoutCommit':
            // Explicitly detached: without --detach git warns and behaves
            // differently depending on whether the hash matches a branch name.
            return ['checkout', '--detach', action.hash];

        case 'checkoutRemote':
            return [
                'checkout',
                '-b',
                action.localName,
                '--track',
                action.remoteBranch,
            ];

        case 'createBranch':
            return action.checkout
                ? ['checkout', '-b', action.name, action.at]
                : ['branch', action.name, action.at];

        case 'deleteBranch':
            // -d refuses to drop unmerged work; -D does not. The caller decides,
            // and the destructive-confirmation rule covers both.
            return ['branch', action.force ? '-D' : '-d', action.name];

        case 'createTag':
            return ['tag', action.name, action.at];

        case 'deleteTag':
            return ['tag', '-d', action.name];

        case 'mergeBranch':
            return action.noFastForward
                ? ['merge', '--no-ff', '--no-edit', action.name]
                : ['merge', '--no-edit', action.name];

        case 'rebaseOnto':
            return ['rebase', action.name];

        case 'cherryPick':
            return ['cherry-pick', action.hash];

        case 'revert':
            // --no-edit so the operation does not hang waiting for an editor
            // that a webview cannot present.
            return ['revert', '--no-edit', action.hash];

        case 'reset':
            return ['reset', `--${action.mode}`, action.hash];

        case 'fetch':
            return ['fetch', '--all', '--prune'];

        case 'pull':
            return ['pull'];

        case 'push':
            return ['push'];

        case 'pushBranch':
            /*
             * The branch is named on both sides of the refspec rather than left
             * to `push.default`: with `matching` — still the default on old
             * configurations — a bare `git push <remote>` pushes every branch
             * whose name exists on the remote, which is emphatically not what
             * "push this branch" means.
             *
             * No `+` prefix and no --force, so a non-fast-forward is refused.
             */
            return [
                'push',
                ...(action.setUpstream ? ['--set-upstream'] : []),
                action.remote,
                `refs/heads/${action.branch}:refs/heads/${action.branch}`,
            ];

        case 'pullBranch':
            // Named explicitly, so the pull cannot be redirected by a stale or
            // surprising upstream configuration.
            return ['pull', action.remote, action.branch];

        case 'stashPush':
            /*
             * `push` rather than the bare `git stash`, which is the same thing
             * but reads as a noun and has no way to carry a message.
             *
             * `--message` last before any pathspec, and no pathspec here: this
             * stashes the whole working tree, which is what the caller asked
             * for. A partial stash would need `--` and a list, and the refusal
             * to guess at one is deliberate.
             */
            return [
                'stash',
                'push',
                ...(action.includeUntracked ? ['--include-untracked'] : []),
                ...(action.keepIndex ? ['--keep-index'] : []),
                ...(action.message ? ['--message', action.message] : []),
            ];

        case 'stashApply':
            // The entry stays on the stack; the caller drops it separately if
            // that is what was meant. See stashPop.
            return ['stash', 'apply', action.ref];

        case 'stashPop':
            return ['stash', 'pop', action.ref];

        case 'stashDrop':
            return ['stash', 'drop', action.ref];

        case 'addRemote':
            return ['remote', 'add', action.name, action.url];

        case 'renameRemote':
            return ['remote', 'rename', action.from, action.to];

        case 'removeRemote':
            // `remove`, not the `rm` alias: identical to git, clearer in a log.
            return ['remote', 'remove', action.name];

        case 'setRemoteUrl':
            // Sets the fetch URL. A separate push URL is left alone, because
            // overwriting a deliberate fork setup silently is worse than making
            // someone run one command.
            return ['remote', 'set-url', action.name, action.url];

        case 'fetchRemote':
            return action.prune
                ? ['fetch', '--prune', action.name]
                : ['fetch', action.name];

        case 'pruneRemote':
            return ['remote', 'prune', action.name];

        case 'updateBranchFromUpstream':
            /*
             * A refspec fetch writes straight to the local branch ref, so the
             * branch advances without being checked out and without touching the
             * working tree or the index.
             *
             * No --force and no leading `+` on the refspec, deliberately: git then
             * refuses anything that is not a fast-forward, which is exactly right.
             * A diverged branch needs a merge or a rebase, and that is a decision
             * for the user rather than something to silently overwrite.
             *
             * Note git also refuses to fetch into the *current* branch, which is
             * why the menu offers a plain pull in that case instead.
             */
            return [
                'fetch',
                action.remote,
                `${action.remoteBranch}:${action.branch}`,
            ];

        case 'deleteRemoteBranch':
            /*
             * `--delete` rather than the older `push remote :branch` colon form,
             * which is easy to mistype into "push everything" and reads like a
             * typo even when correct.
             */
            return ['push', action.remote, '--delete', action.branch];

        case 'renameBranch':
            /*
             * Lower-case -m, not -M: -M overwrites an existing branch of that
             * name, discarding it. Git refusing a name collision is the right
             * outcome here.
             */
            return ['branch', '-m', action.from, action.to];

        case 'addWorktree':
            /*
             * `git worktree add` has no `--` terminator, so a path beginning
             * with `-` would be read as an option. The menu rejects one before
             * it gets here; see describePathProblem.
             *
             * Without --force, git refuses a ref already checked out in another
             * worktree — which is the rule that makes worktrees confusing, and
             * exactly the refusal worth keeping.
             */
            return action.newBranch
                ? [
                      'worktree',
                      'add',
                      '-b',
                      action.newBranch,
                      action.path,
                      action.ref,
                  ]
                : ['worktree', 'add', action.path, action.ref];

        case 'removeWorktree':
            /*
             * The one place --force is emitted, and only when the caller asked
             * for it after git had already refused: git declines to remove a
             * worktree holding uncommitted or untracked files, and overriding
             * that is a decision, not a retry.
             */
            return action.force
                ? ['worktree', 'remove', '--force', action.path]
                : ['worktree', 'remove', action.path];

        case 'pruneWorktrees':
            return ['worktree', 'prune'];

        case 'lockWorktree':
            return action.reason
                ? ['worktree', 'lock', '--reason', action.reason, action.path]
                : ['worktree', 'lock', action.path];

        case 'unlockWorktree':
            return ['worktree', 'unlock', action.path];
    }
}
