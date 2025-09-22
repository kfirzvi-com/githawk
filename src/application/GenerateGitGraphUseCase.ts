import { CommitRow } from '../domain/models/GraphElements';
import { IGitRepository } from '../domain/repositories/IGitRepository';
import { GitGraphService } from '../domain/services/GitGraphService';
import { BranchLayoutService } from '../domain/services/BranchLayoutService';

export class GenerateGitGraphUseCase {
    private readonly gitGraphService: GitGraphService;
    private readonly branchLayoutService: BranchLayoutService;

    constructor(private readonly gitRepository: IGitRepository) {
        this.branchLayoutService = new BranchLayoutService();
        this.gitGraphService = new GitGraphService(this.branchLayoutService);
    }

    async execute(): Promise<CommitRow[]> {
        try {
            const repository = await this.gitRepository.getRepository();
            return this.gitGraphService.generateGraph(repository);
        } catch (error) {
            console.error('Failed to generate Git graph:', error);
            throw new Error('Unable to generate Git graph');
        }
    }
}