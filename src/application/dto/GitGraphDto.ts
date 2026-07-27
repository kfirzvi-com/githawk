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
}

export interface GitGraphDto {
    commits: CommitDto[];
    branches: BranchDto[];
    /** True when history was truncated by the commit limit. */
    hasMoreHistory: boolean;
    /** Branch that should claim lane 0. Absent on a detached HEAD. */
    primaryBranchName?: string;
}
