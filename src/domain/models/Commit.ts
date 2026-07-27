import { Ref, compareRefsForDisplay, isBranchRef } from './Ref';

export interface CommitProps {
    hash: string;
    /** The raw commit message: subject, then body, exactly as written. */
    message: string;
    author: string;
    authorEmail?: string;
    /** Set when the committer differs from the author, as after a rebase or cherry-pick. */
    committer?: string;
    committedAt?: Date;
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
    readonly authorEmail?: string;
    readonly committer?: string;
    readonly committedAt?: Date;
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
        this.authorEmail = props.authorEmail;
        this.committer = props.committer;
        this.committedAt = props.committedAt;
        this.parentHashes = [...props.parentHashes];
        this.refs = [...props.refs];
        this.timestamp = props.timestamp;
        this.branchHint = props.branchHint;
    }

    get shortHash(): string {
        return this.hash.substring(0, 8);
    }

    /** First line of the message — what a graph row shows. */
    get subject(): string {
        const newline = this.message.indexOf('\n');
        return newline === -1 ? this.message : this.message.slice(0, newline);
    }

    /**
     * Everything after the subject, with the blank separator line removed. Empty
     * when the message is a single line, which most are.
     */
    get body(): string {
        const newline = this.message.indexOf('\n');
        return newline === -1 ? '' : this.message.slice(newline + 1).trim();
    }

    get hasBody(): boolean {
        return this.body.length > 0;
    }

    /**
     * True when the commit was authored by one person and committed by another,
     * or at a different time — the fingerprint of a rebase, cherry-pick, or an
     * applied patch. Worth surfacing, because it explains dates that look wrong.
     */
    get wasRewritten(): boolean {
        if (this.committer && this.committer !== this.author) {
            return true;
        }
        return (
            this.committedAt !== undefined &&
            Math.abs(this.committedAt.getTime() - this.timestamp.getTime()) > 1000
        );
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
