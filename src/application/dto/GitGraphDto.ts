import { BranchType, UpstreamState } from '../../domain/models/Branch';
import { Ref } from '../../domain/models/Ref';

/**
 * The serializable shape that crosses the extension-host / webview boundary.
 *
 * These are plain objects on purpose: `postMessage` structured-clones its
 * payload and strips class prototypes, so domain entities cannot travel as
 * entities. The mappers in this directory are the only sanctioned conversion.
 *
 * Note there is no node/edge data here. Layout is computed inside the webview
 * from the same domain service, so the host only ever ships facts about the
 * repository, never geometry.
 */
export interface CommitDto {
    hash: string;
    /** Raw message: subject, then body. */
    message: string;
    author: string;
    authorEmail?: string;
    committer?: string;
    /** ISO 8601, present when it differs meaningfully from the author date. */
    committedAt?: string;
    parentHashes: string[];
    /** Ref is already a plain serializable object, so it crosses as-is. */
    refs: Ref[];
    /** ISO 8601. `Date` does survive structured cloning, but a string keeps the wire format explicit and diffable. */
    timestamp: string;
    branchHint?: string;
}

export interface BranchDto {
    name: string;
    type: BranchType;
    headCommitHash: string;
    isCurrent: boolean;
    upstream?: UpstreamState;
    /** The working tree holding this branch, when one does. */
    worktreePath?: string;
}

export interface StashDto {
    ref: string;
    hash: string;
    branch: string;
    message: string;
    isAutoNamed: boolean;
    /** ISO 8601, like every other date crossing this boundary. */
    createdAt: string;
    author: string;
    baseHash: string;
}

export interface GitGraphDto {
    commits: CommitDto[];
    /**
     * The stash, listed for the sidebar. The entries also appear in `commits`
     * as rows of their own — one is the list, the other is the graph, and they
     * are the same entries.
     */
    stashes: StashDto[];
    branches: BranchDto[];
    /** True when history was truncated by the commit limit. */
    hasMoreHistory: boolean;
    /** Branch that should claim lane 0. Absent on a detached HEAD. */
    primaryBranchName?: string;
}
