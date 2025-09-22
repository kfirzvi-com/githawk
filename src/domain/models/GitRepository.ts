import { Commit } from './Commit';
import { Branch } from './Branch';

export class GitRepository {
    private readonly commitsMap: Map<string, Commit>;
    private readonly branchesMap: Map<string, Branch>;

    constructor(commits: Commit[], branches: Branch[]) {
        this.commitsMap = new Map(commits.map(c => [c.hash, c]));
        this.branchesMap = new Map(branches.map(b => [`${b.type}:${b.name}`, b]));
        this.validateRepository();
    }

    get commits(): Commit[] {
        return Array.from(this.commitsMap.values());
    }

    get branches(): Branch[] {
        return Array.from(this.branchesMap.values());
    }

    get localBranches(): Branch[] {
        return this.branches.filter(b => b.isLocal);
    }

    get remoteBranches(): Branch[] {
        return this.branches.filter(b => b.isRemote);
    }

    get currentBranch(): Branch | undefined {
        return this.branches.find(b => b.isCurrent);
    }

    getCommit(hash: string): Commit | undefined {
        return this.commitsMap.get(hash);
    }

    getBranch(name: string, type: 'local' | 'remote' = 'local'): Branch | undefined {
        return this.branchesMap.get(`${type}:${name}`);
    }

    getCommitParents(commit: Commit): Commit[] {
        return commit.parentHashes
            .map(hash => this.getCommit(hash))
            .filter((c): c is Commit => c !== undefined);
    }

    getCommitsByBranch(branchName: string): Commit[] {
        return this.commits.filter(c => c.hasBranch(branchName));
    }

    getBranchCommits(branchName: string): Commit[] {
        const visited = new Set<string>();
        const result: Commit[] = [];
        
        // Find head commit for the branch
        const branch = this.branches.find(b => b.name === branchName || b.shortName === branchName);
        if (!branch) {
            return [];
        }

        const headCommit = this.getCommit(branch.headCommitHash);
        if (!headCommit) {
            return [];
        }

        // Traverse back from head commit
        this.collectBranchCommits(headCommit, visited, result, branchName);
        return result.reverse(); // Reverse to get chronological order
    }

    private collectBranchCommits(commit: Commit, visited: Set<string>, result: Commit[], branchName: string): void {
        if (visited.has(commit.hash)) {
            return;
        }
        visited.add(commit.hash);

        // Add commit if it belongs to this branch or is a merge target
        if (commit.hasBranch(branchName)) {
            result.push(commit);
        }

        // Continue with parents
        const parents = this.getCommitParents(commit);
        for (const parent of parents) {
            this.collectBranchCommits(parent, visited, result, branchName);
        }
    }

    private validateRepository(): void {
        // Ensure all parent hashes reference existing commits
        for (const commit of this.commits) {
            for (const parentHash of commit.parentHashes) {
                if (!this.commitsMap.has(parentHash)) {
                    throw new Error(`Commit ${commit.shortHash} references non-existent parent ${parentHash.substring(0, 8)}`);
                }
            }
        }

        // Ensure all branch head commits exist
        for (const branch of this.branches) {
            if (!this.commitsMap.has(branch.headCommitHash)) {
                throw new Error(`Branch ${branch.name} references non-existent commit ${branch.headCommitHash.substring(0, 8)}`);
            }
        }
    }
}