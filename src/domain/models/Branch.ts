export type BranchType = 'local' | 'remote';

export interface UpstreamState {
    /** e.g. `origin/main`. */
    name: string;
    /** Commits this branch has that its upstream does not. */
    ahead: number;
    /** Commits the upstream has that this branch does not. */
    behind: number;
    /** The upstream ref no longer exists on the remote. */
    isGone: boolean;
}

export class Branch {
    constructor(
        public readonly name: string,
        public readonly type: BranchType,
        public readonly headCommitHash: string,
        public readonly isCurrent: boolean = false,
        public readonly upstream?: UpstreamState
    ) {
        if (!name || name.trim().length === 0) {
            throw new Error('Branch name cannot be empty');
        }
        if (!headCommitHash || headCommitHash.trim().length === 0) {
            throw new Error('Branch head commit hash cannot be empty');
        }
    }

    get isLocal(): boolean {
        return this.type === 'local';
    }

    get isRemote(): boolean {
        return this.type === 'remote';
    }

    get shortName(): string {
        // Remove origin/ prefix for remote branches
        return this.name.replace(/^origin\//, '');
    }

    get isMainBranch(): boolean {
        const mainBranches = ['main', 'master', 'develop'];
        return mainBranches.includes(this.shortName);
    }

    get isFeatureBranch(): boolean {
        return this.shortName.startsWith('feature/');
    }

    get isHotfixBranch(): boolean {
        return this.shortName.startsWith('hotfix/');
    }

    get isBehind(): boolean {
        return (this.upstream?.behind ?? 0) > 0;
    }

    get isAhead(): boolean {
        return (this.upstream?.ahead ?? 0) > 0;
    }

    /**
     * Both sides have commits the other lacks, so the branch cannot simply be
     * advanced — it needs a merge or a rebase, which needs a checkout.
     */
    get hasDiverged(): boolean {
        return this.isAhead && this.isBehind;
    }

    /**
     * True when the branch can be advanced to its upstream without a merge, and
     * therefore without checking it out or touching the working tree.
     */
    get canFastForwardToUpstream(): boolean {
        return (
            this.isLocal &&
            this.upstream !== undefined &&
            !this.upstream.isGone &&
            this.isBehind &&
            !this.isAhead
        );
    }

    equals(other: Branch): boolean {
        return this.name === other.name && this.type === other.type;
    }
}