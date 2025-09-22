export class Commit {
    constructor(
        public readonly hash: string,
        public readonly message: string,
        public readonly author: string,
        public readonly parentHashes: string[],
        public readonly refs: string[],
        public readonly branchHint?: string,
        public readonly timestamp?: Date
    ) {
        if (!hash || hash.trim().length === 0) {
            throw new Error('Commit hash cannot be empty');
        }
        if (!message || message.trim().length === 0) {
            throw new Error('Commit message cannot be empty');
        }
    }

    get shortHash(): string {
        return this.hash.substring(0, 8);
    }

    get isMergeCommit(): boolean {
        return this.parentHashes.length > 1;
    }

    get isInitialCommit(): boolean {
        return this.parentHashes.length === 0;
    }

    get primaryParentHash(): string | undefined {
        return this.parentHashes[0];
    }

    hasBranch(branchName: string): boolean {
        return this.refs.includes(branchName) || this.branchHint === branchName;
    }

    equals(other: Commit): boolean {
        return this.hash === other.hash;
    }
}