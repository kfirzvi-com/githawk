import { Commit } from '../models/Commit';
import { Ref, localBranchRef, remoteBranchRef, tagRef } from '../models/Ref';

export interface CommitSpec {
    hash: string;
    timestamp: string | Date;
    parentHashes?: string[];
    /** Bare strings read as local branches, which is what most tests mean. */
    refs?: (string | Ref)[];
    tags?: string[];
    remotes?: string[];
    message?: string;
    author?: string;
    branchHint?: string;
    /** Marks the first ref as the checked-out branch. */
    isHead?: boolean;
}

/**
 * Terse Commit construction for tests and fixtures. Only `hash` and `timestamp`
 * carry meaning for layout, so everything else defaults.
 */
export function aCommit(spec: CommitSpec): Commit {
    const refs: Ref[] = [
        ...(spec.refs ?? []).map((ref) =>
            typeof ref === 'string' ? localBranchRef(ref) : ref
        ),
        ...(spec.tags ?? []).map(tagRef),
        ...(spec.remotes ?? []).map(remoteBranchRef),
    ];

    if (spec.isHead && refs.length > 0) {
        refs[0] = { ...refs[0], isHead: true };
    }

    return new Commit({
        hash: spec.hash,
        message: spec.message ?? `commit ${spec.hash}`,
        author: spec.author ?? 'Test Author',
        parentHashes: spec.parentHashes ?? [],
        refs,
        timestamp:
            spec.timestamp instanceof Date
                ? spec.timestamp
                : new Date(spec.timestamp),
        branchHint: spec.branchHint,
    });
}

export function commits(...specs: CommitSpec[]): Commit[] {
    return specs.map(aCommit);
}
