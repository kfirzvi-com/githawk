import { describe, expect, test } from 'vitest';
import { argsFor } from './gitActionCommands';
import {
    GitAction,
    destructiveReason,
    isDestructive,
    requiresCheckedOutBranch,
    usesNetwork,
} from '../../domain/models/GitAction';

describe('argsFor', () => {
    test('checks out a branch by name', () => {
        expect(argsFor({ type: 'checkoutBranch', name: 'feature/x' })).toEqual([
            'checkout',
            'feature/x',
        ]);
    });

    test('detaches explicitly when checking out a commit', () => {
        // Without --detach, git's behaviour depends on whether the hash happens
        // to match a branch name.
        expect(argsFor({ type: 'checkoutCommit', hash: 'abc123' })).toEqual([
            'checkout',
            '--detach',
            'abc123',
        ]);
    });

    test('creates a tracking branch for a remote', () => {
        expect(
            argsFor({
                type: 'checkoutRemote',
                remoteBranch: 'origin/feature/x',
                localName: 'feature/x',
            })
        ).toEqual(['checkout', '-b', 'feature/x', '--track', 'origin/feature/x']);
    });

    test('creates a branch with or without checking it out', () => {
        expect(
            argsFor({ type: 'createBranch', name: 'x', at: 'abc', checkout: true })
        ).toEqual(['checkout', '-b', 'x', 'abc']);
        expect(
            argsFor({ type: 'createBranch', name: 'x', at: 'abc', checkout: false })
        ).toEqual(['branch', 'x', 'abc']);
    });

    test('uses -d normally and -D only when forcing', () => {
        expect(argsFor({ type: 'deleteBranch', name: 'x', force: false })).toEqual([
            'branch',
            '-d',
            'x',
        ]);
        expect(argsFor({ type: 'deleteBranch', name: 'x', force: true })).toEqual([
            'branch',
            '-D',
            'x',
        ]);
    });

    test('never waits for an editor', () => {
        // A webview cannot present git's editor, so anything that would open one
        // must pass --no-edit or the command hangs forever.
        expect(argsFor({ type: 'revert', hash: 'abc' })).toContain('--no-edit');
        expect(
            argsFor({ type: 'mergeBranch', name: 'x', noFastForward: false })
        ).toContain('--no-edit');
        expect(
            argsFor({ type: 'mergeBranch', name: 'x', noFastForward: true })
        ).toContain('--no-edit');
    });

    test('maps each reset mode to its own flag', () => {
        expect(argsFor({ type: 'reset', hash: 'abc', mode: 'soft' })).toEqual([
            'reset',
            '--soft',
            'abc',
        ]);
        expect(argsFor({ type: 'reset', hash: 'abc', mode: 'mixed' })).toEqual([
            'reset',
            '--mixed',
            'abc',
        ]);
        expect(argsFor({ type: 'reset', hash: 'abc', mode: 'hard' })).toEqual([
            'reset',
            '--hard',
            'abc',
        ]);
    });

    test('prunes deleted remote branches when fetching', () => {
        expect(argsFor({ type: 'fetch' })).toEqual(['fetch', '--all', '--prune']);
    });

    test('never emits a force flag, for any action', () => {
        const actions: GitAction[] = [
            { type: 'push' },
            { type: 'pull' },
            { type: 'fetch' },
            { type: 'rebaseOnto', name: 'main' },
            { type: 'mergeBranch', name: 'main', noFastForward: true },
        ];

        for (const action of actions) {
            const args = argsFor(action);
            expect(args).not.toContain('--force');
            expect(args).not.toContain('-f');
            expect(args).not.toContain('--force-with-lease');
        }
    });

    test('passes names through verbatim rather than quoting them', () => {
        // execFile takes an argument array, so a name containing shell syntax is
        // inert. Quoting here would corrupt the name instead.
        const args = argsFor({
            type: 'createBranch',
            name: 'feature/; rm -rf ~',
            at: 'abc',
            checkout: false,
        });

        expect(args).toEqual(['branch', 'feature/; rm -rf ~', 'abc']);
    });
});

describe('worktree commands', () => {
    test('adds a worktree for an existing ref', () => {
        expect(
            argsFor({ type: 'addWorktree', path: '/w/repo-side', ref: 'feature/x' })
        ).toEqual(['worktree', 'add', '/w/repo-side', 'feature/x']);
    });

    test('creates the branch in the worktree when one is named', () => {
        expect(
            argsFor({
                type: 'addWorktree',
                path: '/w/repo-side',
                ref: 'HEAD',
                newBranch: 'feature/x',
            })
        ).toEqual(['worktree', 'add', '-b', 'feature/x', '/w/repo-side', 'HEAD']);
    });

    test('does not force an add, so git can refuse a branch already checked out', () => {
        // That refusal is the rule worth keeping: a branch belongs to one
        // working tree at a time.
        const args = argsFor({
            type: 'addWorktree',
            path: '/w/repo-side',
            ref: 'main',
        });

        expect(args).not.toContain('--force');
        expect(args).not.toContain('-f');
    });

    test('removes a worktree, forcing only when asked', () => {
        expect(
            argsFor({ type: 'removeWorktree', path: '/w/side', force: false })
        ).toEqual(['worktree', 'remove', '/w/side']);
        expect(
            argsFor({ type: 'removeWorktree', path: '/w/side', force: true })
        ).toEqual(['worktree', 'remove', '--force', '/w/side']);
    });

    test('prunes records without touching any directory', () => {
        expect(argsFor({ type: 'pruneWorktrees' })).toEqual(['worktree', 'prune']);
    });

    test('locks with and without a reason', () => {
        expect(argsFor({ type: 'lockWorktree', path: '/w/side' })).toEqual([
            'worktree',
            'lock',
            '/w/side',
        ]);
        expect(
            argsFor({ type: 'lockWorktree', path: '/w/side', reason: 'on a usb' })
        ).toEqual(['worktree', 'lock', '--reason', 'on a usb', '/w/side']);
    });

    test('unlocks', () => {
        expect(argsFor({ type: 'unlockWorktree', path: '/w/side' })).toEqual([
            'worktree',
            'unlock',
            '/w/side',
        ]);
    });

    test('passes a path through verbatim rather than quoting it', () => {
        // execFile takes an argument array, so spaces need no quoting — and
        // quoting here would create a directory with quotes in its name.
        expect(
            argsFor({
                type: 'addWorktree',
                path: '/Users/me/My Projects/repo-wt',
                ref: 'main',
            })
        ).toEqual([
            'worktree',
            'add',
            '/Users/me/My Projects/repo-wt',
            'main',
        ]);
    });
});

describe('isDestructive', () => {
    test('flags resets that touch the index or working tree', () => {
        expect(isDestructive({ type: 'reset', hash: 'a', mode: 'hard' })).toBe(true);
        expect(isDestructive({ type: 'reset', hash: 'a', mode: 'mixed' })).toBe(true);
        // --soft moves only the branch pointer; tree and index survive.
        expect(isDestructive({ type: 'reset', hash: 'a', mode: 'soft' })).toBe(false);
    });

    test('flags deletions and history rewrites', () => {
        expect(
            isDestructive({ type: 'deleteBranch', name: 'x', force: false })
        ).toBe(true);
        expect(isDestructive({ type: 'deleteTag', name: 'v1' })).toBe(true);
        expect(isDestructive({ type: 'rebaseOnto', name: 'main' })).toBe(true);
    });

    test('leaves ordinary navigation and merges unflagged', () => {
        expect(isDestructive({ type: 'checkoutBranch', name: 'x' })).toBe(false);
        expect(
            isDestructive({ type: 'mergeBranch', name: 'x', noFastForward: true })
        ).toBe(false);
        expect(isDestructive({ type: 'cherryPick', hash: 'a' })).toBe(false);
        expect(isDestructive({ type: 'fetch' })).toBe(false);
    });

    test('removing a worktree is destructive; pruning records is not', () => {
        // Removing deletes a directory. Pruning only discards records for
        // directories that are already gone, so there is nothing left to lose.
        expect(
            isDestructive({ type: 'removeWorktree', path: '/w', force: false })
        ).toBe(true);
        expect(isDestructive({ type: 'pruneWorktrees' })).toBe(false);
        expect(isDestructive({ type: 'addWorktree', path: '/w', ref: 'main' })).toBe(
            false
        );
        expect(isDestructive({ type: 'lockWorktree', path: '/w' })).toBe(false);
    });

    test('every destructive action explains itself', () => {
        const destructive: GitAction[] = [
            { type: 'reset', hash: 'a', mode: 'hard' },
            { type: 'reset', hash: 'a', mode: 'mixed' },
            { type: 'deleteBranch', name: 'x', force: true },
            { type: 'deleteBranch', name: 'x', force: false },
            { type: 'deleteTag', name: 'v1' },
            { type: 'rebaseOnto', name: 'main' },
            { type: 'removeWorktree', path: '/w', force: false },
            { type: 'removeWorktree', path: '/w', force: true },
        ];

        for (const action of destructive) {
            expect(isDestructive(action)).toBe(true);
            // A confirmation with no stated consequence is just a speed bump.
            expect(destructiveReason(action)).toBeTruthy();
        }
    });
});

describe('requiresCheckedOutBranch', () => {
    test('identifies actions that need a branch, not a detached HEAD', () => {
        expect(requiresCheckedOutBranch({ type: 'pull' })).toBe(true);
        expect(requiresCheckedOutBranch({ type: 'push' })).toBe(true);
        expect(requiresCheckedOutBranch({ type: 'rebaseOnto', name: 'main' })).toBe(
            true
        );
        expect(
            requiresCheckedOutBranch({
                type: 'mergeBranch',
                name: 'main',
                noFastForward: false,
            })
        ).toBe(true);

        expect(requiresCheckedOutBranch({ type: 'fetch' })).toBe(false);
        expect(requiresCheckedOutBranch({ type: 'checkoutBranch', name: 'x' })).toBe(
            false
        );
    });
});

describe('updating a branch you are not on', () => {
    test('writes to the local ref with a refspec fetch', () => {
        expect(
            argsFor({
                type: 'updateBranchFromUpstream',
                branch: 'main',
                remote: 'origin',
                remoteBranch: 'main',
            })
        ).toEqual(['fetch', 'origin', 'main:main']);
    });

    test('handles an upstream whose name differs from the local branch', () => {
        expect(
            argsFor({
                type: 'updateBranchFromUpstream',
                branch: 'release',
                remote: 'upstream',
                remoteBranch: 'stable',
            })
        ).toEqual(['fetch', 'upstream', 'stable:release']);
    });

    test('never forces the update', () => {
        const args = argsFor({
            type: 'updateBranchFromUpstream',
            branch: 'main',
            remote: 'origin',
            remoteBranch: 'main',
        });

        // A leading `+` on the refspec, or --force, would let a diverged branch be
        // overwritten and lose commits. Git must be allowed to refuse.
        expect(args).not.toContain('--force');
        expect(args.some((arg) => arg.startsWith('+'))).toBe(false);
    });

    test('is not destructive, because git will not discard commits', () => {
        expect(
            isDestructive({
                type: 'updateBranchFromUpstream',
                branch: 'main',
                remote: 'origin',
                remoteBranch: 'main',
            })
        ).toBe(false);
    });

    test('is recognised as a network operation', () => {
        expect(
            usesNetwork({
                type: 'updateBranchFromUpstream',
                branch: 'main',
                remote: 'origin',
                remoteBranch: 'main',
            })
        ).toBe(true);
        expect(usesNetwork({ type: 'checkoutBranch', name: 'x' })).toBe(false);
    });
});

describe('pushing and pulling one named branch', () => {
    test('names the branch on both sides of the refspec', () => {
        /*
         * Not `git push origin main`, which defers to push.default — under the
         * `matching` setting still present in old configurations that pushes
         * every branch the remote already has, which is not what the menu
         * entry says it does.
         */
        expect(
            argsFor({
                type: 'pushBranch',
                remote: 'origin',
                branch: 'feature/x',
                setUpstream: false,
            })
        ).toEqual([
            'push',
            'origin',
            'refs/heads/feature/x:refs/heads/feature/x',
        ]);
    });

    test('sets the upstream when publishing a branch for the first time', () => {
        expect(
            argsFor({
                type: 'pushBranch',
                remote: 'origin',
                branch: 'feature/x',
                setUpstream: true,
            })
        ).toEqual([
            'push',
            '--set-upstream',
            'origin',
            'refs/heads/feature/x:refs/heads/feature/x',
        ]);
    });

    test('never forces a push', () => {
        // A refused non-fast-forward is the safety property. Overwriting a
        // colleague's commits must not be one flag away.
        const args = argsFor({
            type: 'pushBranch',
            remote: 'origin',
            branch: 'main',
            setUpstream: false,
        });

        expect(args).not.toContain('--force');
        expect(args).not.toContain('--force-with-lease');
        expect(args.some((arg) => arg.startsWith('+'))).toBe(false);
    });

    test('pulls from a named remote and branch rather than the configured one', () => {
        expect(
            argsFor({ type: 'pullBranch', remote: 'origin', branch: 'main' })
        ).toEqual(['pull', 'origin', 'main']);
    });

    test('both reach the network, and both need a branch checked out', () => {
        const push: GitAction = {
            type: 'pushBranch',
            remote: 'origin',
            branch: 'main',
            setUpstream: false,
        };
        const pull: GitAction = {
            type: 'pullBranch',
            remote: 'origin',
            branch: 'main',
        };

        expect(usesNetwork(push)).toBe(true);
        expect(usesNetwork(pull)).toBe(true);
        // A push writes a ref on the server, not here; a pull merges into HEAD.
        expect(requiresCheckedOutBranch(pull)).toBe(true);
        expect(isDestructive(push)).toBe(false);
    });
});

describe('remote management commands', () => {
    test('adds, renames, and re-points a remote', () => {
        expect(
            argsFor({
                type: 'addRemote',
                name: 'upstream',
                url: 'git@github.com:owner/repo.git',
            })
        ).toEqual([
            'remote',
            'add',
            'upstream',
            'git@github.com:owner/repo.git',
        ]);
        expect(
            argsFor({ type: 'renameRemote', from: 'origin', to: 'upstream' })
        ).toEqual(['remote', 'rename', 'origin', 'upstream']);
        expect(
            argsFor({
                type: 'setRemoteUrl',
                name: 'origin',
                url: 'https://example.com/r.git',
            })
        ).toEqual([
            'remote',
            'set-url',
            'origin',
            'https://example.com/r.git',
        ]);
    });

    test('removes a remote, and prunes what it no longer has', () => {
        expect(argsFor({ type: 'removeRemote', name: 'origin' })).toEqual([
            'remote',
            'remove',
            'origin',
        ]);
        expect(argsFor({ type: 'pruneRemote', name: 'origin' })).toEqual([
            'remote',
            'prune',
            'origin',
        ]);
    });

    test('fetches one remote, with and without pruning', () => {
        expect(
            argsFor({ type: 'fetchRemote', name: 'origin', prune: true })
        ).toEqual(['fetch', '--prune', 'origin']);
        expect(
            argsFor({ type: 'fetchRemote', name: 'origin', prune: false })
        ).toEqual(['fetch', 'origin']);
    });

    test('removing and pruning are destructive, and say why', () => {
        // Both delete refs that nothing in the reflog brings back: removing
        // takes every tracking branch with it, and pruning trusts a remote
        // that may simply be unreachable.
        for (const action of [
            { type: 'removeRemote', name: 'origin' },
            { type: 'pruneRemote', name: 'origin' },
        ] satisfies GitAction[]) {
            expect(isDestructive(action)).toBe(true);
            expect(destructiveReason(action)).toBeTruthy();
        }

        expect(
            isDestructive({ type: 'addRemote', name: 'x', url: 'u' })
        ).toBe(false);
        expect(
            isDestructive({ type: 'fetchRemote', name: 'origin', prune: true })
        ).toBe(false);
    });
});
