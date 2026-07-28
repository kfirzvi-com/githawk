export type ResetMode = 'soft' | 'mixed' | 'hard';

/**
 * Every mutating operation, as data.
 *
 * A discriminated union rather than a wide port interface: adding an action means
 * adding one variant, one command mapping, and one menu entry, and the compiler
 * finds the places that need updating. It also makes the dangerous part — which
 * git command a given intent turns into — a pure function that can be tested
 * without a repository, which matters when the wrong flag destroys work.
 */
export type GitAction =
    | { type: 'checkoutBranch'; name: string }
    | { type: 'checkoutCommit'; hash: string }
    | { type: 'checkoutRemote'; remoteBranch: string; localName: string }
    | { type: 'createBranch'; name: string; at: string; checkout: boolean }
    | { type: 'deleteBranch'; name: string; force: boolean }
    | { type: 'createTag'; name: string; at: string }
    | { type: 'deleteTag'; name: string }
    | { type: 'mergeBranch'; name: string; noFastForward: boolean }
    | { type: 'rebaseOnto'; name: string }
    | { type: 'cherryPick'; hash: string }
    | { type: 'revert'; hash: string }
    | { type: 'reset'; hash: string; mode: ResetMode }
    | { type: 'fetch' }
    | { type: 'pull' }
    | { type: 'push' }
    /**
     * Advances a local branch to its upstream without checking it out.
     * Fast-forward only — git refuses anything else, which is the desired
     * behaviour rather than a limitation to work around.
     */
    | {
          type: 'updateBranchFromUpstream';
          branch: string;
          remote: string;
          remoteBranch: string;
      }
    /** Deletes the branch on the server. Visible to everyone, not just you. */
    | { type: 'deleteRemoteBranch'; remote: string; branch: string }
    | { type: 'renameBranch'; from: string; to: string }
    /**
     * Checks `ref` out into a second working tree at `path`. With `newBranch`,
     * creates that branch there and treats `ref` as its start point.
     */
    | { type: 'addWorktree'; path: string; ref: string; newBranch?: string }
    /** Deletes the worktree's directory and git's record of it. */
    | { type: 'removeWorktree'; path: string; force: boolean }
    /** Discards records for worktrees whose directories are already gone. */
    | { type: 'pruneWorktrees' }
    /** Stops prune from discarding a worktree that is temporarily unreachable. */
    | { type: 'lockWorktree'; path: string; reason?: string }
    | { type: 'unlockWorktree'; path: string };

export type GitActionType = GitAction['type'];

/**
 * Actions that can destroy work that is not recoverable from the reflog, or that
 * rewrite history. The host must confirm these before running them.
 *
 * Deliberately conservative: `reset --mixed` is included because it unstages
 * work, which surprises people even though files survive.
 */
export function isDestructive(action: GitAction): boolean {
    switch (action.type) {
        case 'reset':
            return action.mode === 'hard' || action.mode === 'mixed';
        case 'deleteBranch':
            return true;
        case 'deleteTag':
            return true;
        case 'rebaseOnto':
            return true;
        case 'deleteRemoteBranch':
            return true;
        case 'removeWorktree':
            // Deletes a directory from disk. Git refuses a dirty one without
            // --force, but a clean directory still disappears.
            return true;
        default:
            return false;
    }
}

/**
 * Why an action is dangerous, in git's terms. Phrasing for the user lives in the
 * host, but the underlying claim is git semantics and belongs with the rule.
 */
export function destructiveReason(action: GitAction): string | undefined {
    switch (action.type) {
        case 'reset':
            if (action.mode === 'hard') {
                return 'discards all uncommitted changes in the working tree';
            }
            if (action.mode === 'mixed') {
                return 'unstages changes, keeping files on disk';
            }
            return undefined;
        case 'deleteBranch':
            return action.force
                ? 'deletes the branch even if it has unmerged commits'
                : 'deletes the branch';
        case 'deleteTag':
            return 'deletes the tag locally';
        case 'deleteRemoteBranch':
            return `deletes ${action.branch} from ${action.remote}, for everyone — not just locally`;
        case 'rebaseOnto':
            return 'rewrites commits on the current branch';
        case 'removeWorktree':
            return action.force
                ? 'deletes the worktree directory along with any uncommitted or untracked files in it'
                : 'deletes the worktree directory from disk';
        default:
            return undefined;
    }
}

/**
 * Actions that reach the network. Worth distinguishing so the UI can say why an
 * operation is slow, and so an offline failure reads as a connectivity problem
 * rather than a git one.
 */
export function usesNetwork(action: GitAction): boolean {
    return (
        action.type === 'fetch' ||
        action.type === 'pull' ||
        action.type === 'push' ||
        action.type === 'updateBranchFromUpstream' ||
        action.type === 'deleteRemoteBranch'
    );
}

/** Actions that only make sense with a branch checked out. */
export function requiresCheckedOutBranch(action: GitAction): boolean {
    return (
        action.type === 'mergeBranch' ||
        action.type === 'rebaseOnto' ||
        action.type === 'pull' ||
        action.type === 'push'
    );
}
