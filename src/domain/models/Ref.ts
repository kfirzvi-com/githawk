export type RefKind = 'localBranch' | 'remoteBranch' | 'tag' | 'head';

/**
 * A decoration pointing at a commit.
 *
 * Kept as a structured value rather than a bare string because the view needs to
 * tell a branch from a tag from HEAD, and a flattened `string[]` cannot: `v1.0`
 * and `main` are indistinguishable once the `refs/` prefix is gone.
 */
export interface Ref {
    kind: RefKind;
    /** Short name: `main`, `origin/main`, `v1.2.0`. Empty for a detached HEAD. */
    name: string;
    /** True when HEAD points here, i.e. this is the checked-out branch. */
    isHead: boolean;
}

export function localBranchRef(name: string, isHead = false): Ref {
    return { kind: 'localBranch', name, isHead };
}

export function remoteBranchRef(name: string): Ref {
    return { kind: 'remoteBranch', name, isHead: false };
}

export function tagRef(name: string): Ref {
    return { kind: 'tag', name, isHead: false };
}

export function detachedHeadRef(): Ref {
    return { kind: 'head', name: 'HEAD', isHead: true };
}

export function isBranchRef(ref: Ref): boolean {
    return ref.kind === 'localBranch' || ref.kind === 'remoteBranch';
}

/**
 * Ordering for display: the checked-out branch first, then local branches, then
 * tags, then remotes. Remote branches come last because they are usually
 * duplicates of a local branch already shown.
 */
const KIND_ORDER: Record<RefKind, number> = {
    head: 0,
    localBranch: 1,
    tag: 2,
    remoteBranch: 3,
};

export function compareRefsForDisplay(a: Ref, b: Ref): number {
    if (a.isHead !== b.isHead) {
        return a.isHead ? -1 : 1;
    }
    const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return byKind !== 0 ? byKind : a.name.localeCompare(b.name);
}
