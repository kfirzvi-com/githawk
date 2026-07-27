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
    }
}
