import { Commit } from '../models/Commit';

export interface CommitSpec {
    hash: string;
    timestamp: string | Date;
    parentHashes?: string[];
    refs?: string[];
    message?: string;
    author?: string;
    branchHint?: string;
}

/**
 * Terse Commit construction for tests and fixtures. Only `hash` and `timestamp`
 * carry meaning for layout, so everything else defaults.
 */
export function aCommit(spec: CommitSpec): Commit {
    return new Commit({
        hash: spec.hash,
        message: spec.message ?? `commit ${spec.hash}`,
        author: spec.author ?? 'Test Author',
        parentHashes: spec.parentHashes ?? [],
        refs: spec.refs ?? [],
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
