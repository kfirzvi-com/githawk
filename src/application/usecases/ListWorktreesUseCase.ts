import { WorktreeDto } from '../dto/WorktreeDto';
import { WorktreeMapper } from '../dto/mappers';
import { IWorktreeReader } from '../../domain/repositories/IWorktreeReader';
import { Worktree } from '../../domain/models/Worktree';

/**
 * Lists the repository's working trees, main one first.
 *
 * Git already returns them in that order; the sort makes it a guarantee of this
 * use case rather than an observed habit of the CLI, so the UI can rely on the
 * first entry being the original clone.
 */
export class ListWorktreesUseCase {
    constructor(private readonly reader: IWorktreeReader) {}

    async execute(): Promise<Worktree[]> {
        const worktrees = await this.reader.list();

        return worktrees
            .slice()
            .sort((a, b) => {
                if (a.isMain !== b.isMain) {
                    return a.isMain ? -1 : 1;
                }
                return a.path.localeCompare(b.path);
            });
    }

    async executeAsDtos(): Promise<WorktreeDto[]> {
        return (await this.execute()).map(WorktreeMapper.toDto);
    }
}
