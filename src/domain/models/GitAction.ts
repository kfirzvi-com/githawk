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
    | { type: 'push' };

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
        case 'rebaseOnto':
            return 'rewrites commits on the current branch';
        default:
            return undefined;
    }
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
