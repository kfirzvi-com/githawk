import { Branch } from '../../domain/models/Branch';
import { Commit } from '../../domain/models/Commit';
import { Worktree } from '../../domain/models/Worktree';
import { Stash } from '../../domain/models/Stash';
import { stashRef } from '../../domain/models/Ref';
import { BranchDto, CommitDto, StashDto } from './GitGraphDto';
import { WorktreeDto } from './WorktreeDto';

export const StashMapper = {
    toDto(stash: Stash): StashDto {
        return {
            ref: stash.ref,
            hash: stash.hash,
            branch: stash.branch,
            message: stash.message,
            isAutoNamed: stash.isAutoNamed,
            createdAt: stash.createdAt.toISOString(),
            author: stash.author,
            baseHash: stash.baseHash,
        };
    },

    fromDto(dto: StashDto, index: number): Stash {
        return {
            ...dto,
            index,
            shortHash: dto.hash.slice(0, 8),
            createdAt: new Date(dto.createdAt),
        };
    },

    /**
     * A stash entry as a row in the graph.
     *
     * Its own commit, with only its base as a parent: the index and untracked
     * snapshots git hangs off it are bookkeeping, and drawing them would put
     * two commits nobody wrote into the history.
     */
    toCommitDto(dto: StashDto): CommitDto {
        return {
            hash: dto.hash,
            message: dto.isAutoNamed
                ? `${dto.message} (unnamed stash)`
                : dto.message,
            author: dto.author,
            parentHashes: dto.baseHash ? [dto.baseHash] : [],
            refs: [stashRef(dto.ref)],
            timestamp: dto.createdAt,
        };
    },
};

export const CommitMapper = {
    toDto(commit: Commit): CommitDto {
        return {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            committer: commit.committer,
            committedAt: commit.committedAt?.toISOString(),
            parentHashes: commit.parentHashes,
            refs: commit.refs,
            timestamp: commit.timestamp.toISOString(),
            branchHint: commit.branchHint,
        };
    },

    fromDto(dto: CommitDto): Commit {
        return new Commit({
            hash: dto.hash,
            message: dto.message,
            author: dto.author,
            authorEmail: dto.authorEmail,
            committer: dto.committer,
            committedAt: dto.committedAt ? new Date(dto.committedAt) : undefined,
            parentHashes: dto.parentHashes,
            refs: dto.refs,
            timestamp: new Date(dto.timestamp),
            branchHint: dto.branchHint,
        });
    },
};

export const BranchMapper = {
    toDto(branch: Branch): BranchDto {
        return {
            name: branch.name,
            type: branch.type,
            headCommitHash: branch.headCommitHash,
            isCurrent: branch.isCurrent,
            upstream: branch.upstream,
            worktreePath: branch.worktreePath,
        };
    },

    fromDto(dto: BranchDto): Branch {
        return new Branch(
            dto.name,
            dto.type,
            dto.headCommitHash,
            dto.isCurrent,
            dto.upstream,
            dto.worktreePath
        );
    },
};

export const WorktreeMapper = {
    toDto(worktree: Worktree): WorktreeDto {
        return {
            path: worktree.path,
            head: worktree.head,
            branch: worktree.branch,
            isBare: worktree.isBare,
            isMain: worktree.isMain,
            isCurrent: worktree.isCurrent,
            isLocked: worktree.isLocked,
            lockReason: worktree.lockReason,
            isPrunable: worktree.isPrunable,
            prunableReason: worktree.prunableReason,
        };
    },

    fromDto(dto: WorktreeDto): Worktree {
        return new Worktree(dto);
    },
};
