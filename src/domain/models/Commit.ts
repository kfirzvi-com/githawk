import { Ref, compareRefsForDisplay, isBranchRef } from './Ref';

export interface CommitProps {
    hash: string;
    message: string;
    author: string;
    parentHashes: string[];
    refs: Ref[];
    timestamp: Date;
    /**
     * Which branch this commit was observed on, when the ref list alone is
     * ambiguous. Fixture-only for now; real git derives this from refs and
     * topology, so this is a candidate for removal once GitCliRepository lands.
     */
    branchHint?: string;
}

export class Commit {
    readonly hash: string;
    readonly message: string;
    readonly author: string;
    readonly parentHashes: string[];
    readonly refs: Ref[];
    readonly timestamp: Date;
    readonly branchHint?: string;

    constructor(props: CommitProps) {
        if (!props.hash || props.hash.trim().length === 0) {
            throw new Error('Commit hash cannot be empty');
        }

        // An empty message is intentionally allowed: git permits it via
        // `git commit --allow-empty-message`, and rejecting it here would make
        // the graph unrenderable for any repository that contains one.
        this.hash = props.hash;
        this.message = props.message;
        this.author = props.author;
        this.parentHashes = [...props.parentHashes];
        this.refs = [...props.refs];
        this.timestamp = props.timestamp;
        this.branchHint = props.branchHint;
    }

    get shortHash(): string {
        return this.hash.substring(0, 8);
    }

    get isMergeCommit(): boolean {
        return this.parentHashes.length > 1;
    }

    get isRootCommit(): boolean {
        return this.parentHashes.length === 0;
    }

    get primaryParentHash(): string | undefined {
        return this.parentHashes[0];
    }

    /** Refs in display order: checked-out branch, local branches, tags, remotes. */
    get sortedRefs(): Ref[] {
        return [...this.refs].sort(compareRefsForDisplay);
    }

    get branchNames(): string[] {
        return this.refs.filter(isBranchRef).map((ref) => ref.name);
    }

    get tagNames(): string[] {
        return this.refs.filter((ref) => ref.kind === 'tag').map((r) => r.name);
    }

    get isHead(): boolean {
        return this.refs.some((ref) => ref.isHead);
    }

    hasBranch(branchName: string): boolean {
        return (
            this.refs.some(
                (ref) => isBranchRef(ref) && ref.name === branchName
            ) || this.branchHint === branchName
        );
    }

    equals(other: Commit): boolean {
        return this.hash === other.hash;
    }
}
