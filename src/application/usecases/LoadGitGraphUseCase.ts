import { IGitRepository } from '../../domain/repositories/IGitRepository';
import { GitGraphDto } from '../dto/GitGraphDto';
import { BranchMapper, CommitMapper } from '../dto/mappers';

/**
 * Loads the repository and hands back the wire shape. Deliberately thin: the
 * host is a data pump, and all layout happens in the webview.
 */
export class LoadGitGraphUseCase {
    constructor(private readonly repository: IGitRepository) {}

    async execute(): Promise<GitGraphDto> {
        const repository = await this.repository.getRepository();

        return {
            commits: repository.commits.map(CommitMapper.toDto),
            branches: repository.branches.map(BranchMapper.toDto),
        };
    }
}
