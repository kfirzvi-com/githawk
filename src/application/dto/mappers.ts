import { Branch } from '../../domain/models/Branch';
import { Commit } from '../../domain/models/Commit';
import { BranchDto, CommitDto } from './GitGraphDto';

export const CommitMapper = {
    toDto(commit: Commit): CommitDto {
        return {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
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
        };
    },

    fromDto(dto: BranchDto): Branch {
        return new Branch(dto.name, dto.type, dto.headCommitHash, dto.isCurrent);
    },
};
