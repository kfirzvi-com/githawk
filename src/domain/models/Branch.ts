export type BranchType = 'local' | 'remote';

export class Branch {
    constructor(
        public readonly name: string,
        public readonly type: BranchType,
        public readonly headCommitHash: string,
        public readonly isCurrent: boolean = false
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

    equals(other: Branch): boolean {
        return this.name === other.name && this.type === other.type;
    }
}