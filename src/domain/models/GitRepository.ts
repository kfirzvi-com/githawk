import { Branch } from './Branch';
import { Commit } from './Commit';

/**
 * A loaded window of a repository's history.
 *
 * "Window" is the important word: history is read in pages, so a repository is
 * routinely incomplete in two normal ways —
 *
 *  - the oldest loaded commits reference parents that were not loaded, and
 *  - a branch tip can sit outside the window entirely.
 *
 * Neither is an error. Treating them as one made the previous version throw on
 * any real repository large enough to need a limit.
 */
export class GitRepository {
    private readonly commitsByHash: Map<string, Commit>;
    private readonly branchesByKey: Map<string, Branch>;

    constructor(
        commits: Commit[],
        branches: Branch[],
        /** True when history was truncated, i.e. older commits exist upstream. */
        readonly hasMoreHistory: boolean = false
    ) {
        this.commitsByHash = new Map(commits.map((c) => [c.hash, c]));
        this.branchesByKey = new Map(
            branches.map((b) => [`${b.type}:${b.name}`, b])
        );
    }

    get commits(): Commit[] {
        return Array.from(this.commitsByHash.values());
    }

    get branches(): Branch[] {
        return Array.from(this.branchesByKey.values());
    }

    get localBranches(): Branch[] {
        return this.branches.filter((b) => b.isLocal);
    }

    get remoteBranches(): Branch[] {
        return this.branches.filter((b) => b.isRemote);
    }

    get currentBranch(): Branch | undefined {
        return this.branches.find((b) => b.isCurrent);
    }

    get isEmpty(): boolean {
        return this.commitsByHash.size === 0;
    }

    /**
     * Parent hashes referenced by loaded commits but not themselves loaded —
     * the ragged edge of the window. Useful for drawing a "history continues"
     * affordance and for deciding what a "load more" would fetch.
     */
    get boundaryParentHashes(): string[] {
        const boundary = new Set<string>();

        for (const commit of this.commitsByHash.values()) {
            for (const parentHash of commit.parentHashes) {
                if (!this.commitsByHash.has(parentHash)) {
                    boundary.add(parentHash);
                }
            }
        }

        return Array.from(boundary);
    }

    getCommit(hash: string): Commit | undefined {
        return this.commitsByHash.get(hash);
    }

    getBranch(name: string, type: 'local' | 'remote' = 'local'): Branch | undefined {
        return this.branchesByKey.get(`${type}:${name}`);
    }

    /** Only the parents present in this window; boundary parents are omitted. */
    getLoadedParents(commit: Commit): Commit[] {
        return commit.parentHashes
            .map((hash) => this.getCommit(hash))
            .filter((c): c is Commit => c !== undefined);
    }
}
