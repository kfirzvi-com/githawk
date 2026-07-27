import { describe, expect, test } from 'vitest';
import { argsFor } from './gitActionCommands';
import {
    GitAction,
    destructiveReason,
    isDestructive,
    requiresCheckedOutBranch,
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

    test('every destructive action explains itself', () => {
        const destructive: GitAction[] = [
            { type: 'reset', hash: 'a', mode: 'hard' },
            { type: 'reset', hash: 'a', mode: 'mixed' },
            { type: 'deleteBranch', name: 'x', force: true },
            { type: 'deleteBranch', name: 'x', force: false },
            { type: 'deleteTag', name: 'v1' },
            { type: 'rebaseOnto', name: 'main' },
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
