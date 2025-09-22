import { Commit } from '../domain/models/Commit';
import { Branch } from '../domain/models/Branch';
import { GenerateGitGraphUseCase } from '../application/GenerateGitGraphUseCase';
import { GitGraphRenderer } from './GitGraphRenderer';
import { IGitRepository } from '../domain/repositories/IGitRepository';

export interface WebviewMessage {
    type: string;
    data?: any;
}

export interface GitGraphData {
    commits: Array<{
        hash: string;
        message: string;
        author: string;
        parents: string[];
        refs: string[];
        branchHint?: string;
    }>;
    branches: Array<{
        name: string;
        type: 'local' | 'remote';
        current: boolean;
        commit: string;
    }>;
}

export class GitGraphWebviewController {
    private readonly generateGraphUseCase: GenerateGitGraphUseCase;
    private readonly renderer: GitGraphRenderer;

    constructor(gitRepository: IGitRepository) {
        this.generateGraphUseCase = new GenerateGitGraphUseCase(gitRepository);
        this.renderer = new GitGraphRenderer();
    }

    async getInitialData(): Promise<GitGraphData> {
        const repository = await this.generateGraphUseCase['gitRepository'].getRepository();
        
        return {
            commits: repository.commits.map(this.mapCommitToDTO),
            branches: repository.branches.map(this.mapBranchToDTO)
        };
    }

    async generateGraphHTML(): Promise<string> {
        const commitRows = await this.generateGraphUseCase.execute();
        return this.renderer.renderCommitTable(commitRows);
    }

    handleMessage(message: WebviewMessage): WebviewMessage | null {
        switch (message.type) {
            case 'selectCommit':
                return this.handleSelectCommit(message.data);
            case 'selectBranch':
                return this.handleSelectBranch(message.data);
            case 'refreshGraph':
                return this.handleRefreshGraph();
            default:
                console.warn('Unknown message type:', message.type);
                return null;
        }
    }

    private handleSelectCommit(commitHash: string): WebviewMessage {
        // In a real implementation, you'd fetch commit details
        return {
            type: 'commitSelected',
            data: { hash: commitHash }
        };
    }

    private handleSelectBranch(branchName: string): WebviewMessage {
        return {
            type: 'branchSelected',
            data: { name: branchName }
        };
    }

    private handleRefreshGraph(): WebviewMessage {
        return {
            type: 'graphRefreshRequested'
        };
    }

    private mapCommitToDTO(commit: Commit) {
        return {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            parents: commit.parentHashes,
            refs: commit.refs,
            branchHint: commit.branchHint
        };
    }

    private mapBranchToDTO(branch: Branch) {
        return {
            name: branch.name,
            type: branch.type,
            current: branch.isCurrent,
            commit: branch.headCommitHash
        };
    }
}