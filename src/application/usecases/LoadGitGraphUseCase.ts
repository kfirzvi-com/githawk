import { IGitRepository } from '../../domain/repositories/IGitRepository';
import { IStashReader } from '../../domain/repositories/IStashReader';
import { CommitDto, GitGraphDto, StashDto } from '../dto/GitGraphDto';
import { BranchMapper, CommitMapper, StashMapper } from '../dto/mappers';

/**
 * Loads the repository and hands back the wire shape. Deliberately thin: the
 * host is a data pump, and all layout happens in the webview.
 */
export class LoadGitGraphUseCase {
    constructor(
        private readonly repository: IGitRepository,
        /**
         * Optional: the dev harness has no stash, and a repository whose stash
         * cannot be read should still draw its history.
         */
        private readonly stashes?: IStashReader
    ) {}

    async execute(): Promise<GitGraphDto> {
        const [repository, stashes] = await Promise.all([
            this.repository.getRepository(),
            this.readStashes(),
        ]);

        return {
            /*
             * Stash entries are commits, so they are commits here. `git log
             * --all` does not walk refs/stash and could not reach the older
             * entries anyway — they live in the reflog — so they are added
             * rather than found.
             */
            commits: withoutDuplicates([
                ...repository.commits.map(CommitMapper.toDto),
                ...stashes.map(StashMapper.toCommitDto),
            ]),
            stashes,
            branches: repository.branches.map(BranchMapper.toDto),
            hasMoreHistory: repository.hasMoreHistory,
            // The checked-out branch is the one the reader is oriented around,
            // so it earns the spine. Undefined on a detached HEAD, which lets
            // the layout fall back to conventional default names.
            primaryBranchName: repository.currentBranch?.name,
        };
    }

    /** Never allowed to cost the graph: a stash is an extra, not the history. */
    private async readStashes(): Promise<StashDto[]> {
        if (!this.stashes) {
            return [];
        }
        try {
            return (await this.stashes.list()).map(StashMapper.toDto);
        } catch {
            return [];
        }
    }
}

/**
 * Belt and braces around the merge above.
 *
 * The log excludes `refs/stash` so a stash entry cannot arrive twice, but the
 * cost of being wrong about that is out of proportion to the check: the webview
 * keys its rows by hash, and a duplicate key is a hard error in Svelte, which
 * takes the whole panel down to a spinner that never resolves. It has done
 * exactly that once.
 */
function withoutDuplicates(commits: CommitDto[]): CommitDto[] {
    const seen = new Set<string>();
    return commits.filter((commit) => {
        if (seen.has(commit.hash)) {
            return false;
        }
        seen.add(commit.hash);
        return true;
    });
}
