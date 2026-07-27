import { describe, expect, it } from 'vitest';
import { Branch, UpstreamState } from './Branch';

const upstream = (overrides: Partial<UpstreamState> = {}): UpstreamState => ({
    name: 'origin/main',
    ahead: 0,
    behind: 0,
    isGone: false,
    ...overrides,
});

const local = (name: string, state?: UpstreamState) =>
    new Branch(name, 'local', 'abc123', false, state);

describe('Branch upstream state', () => {
    it('reports a branch level with its upstream as neither ahead nor behind', () => {
        const branch = local('main', upstream());

        expect(branch.isAhead).toBe(false);
        expect(branch.isBehind).toBe(false);
        expect(branch.hasDiverged).toBe(false);
        expect(branch.canFastForwardToUpstream).toBe(false);
    });

    it('can fast-forward when purely behind', () => {
        const branch = local('main', upstream({ behind: 3 }));

        expect(branch.isBehind).toBe(true);
        expect(branch.canFastForwardToUpstream).toBe(true);
    });

    it('cannot fast-forward when purely ahead', () => {
        const branch = local('main', upstream({ ahead: 2 }));

        // Nothing to pull; this branch needs pushing instead.
        expect(branch.canFastForwardToUpstream).toBe(false);
        expect(branch.hasDiverged).toBe(false);
    });

    it('cannot fast-forward once diverged', () => {
        const branch = local('main', upstream({ ahead: 2, behind: 3 }));

        // Advancing would discard the local commits, so git must refuse.
        expect(branch.hasDiverged).toBe(true);
        expect(branch.canFastForwardToUpstream).toBe(false);
    });

    it('cannot fast-forward to an upstream that no longer exists', () => {
        const branch = local('main', upstream({ behind: 3, isGone: true }));

        expect(branch.canFastForwardToUpstream).toBe(false);
    });

    it('cannot fast-forward without an upstream at all', () => {
        expect(local('main').canFastForwardToUpstream).toBe(false);
    });

    it('never offers to fast-forward a remote-tracking branch', () => {
        const remote = new Branch(
            'origin/main',
            'remote',
            'abc123',
            false,
            upstream({ behind: 3 })
        );

        expect(remote.canFastForwardToUpstream).toBe(false);
    });
});
