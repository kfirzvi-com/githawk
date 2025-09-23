import { Commit } from '../domain/models/Commit';
import { Branch } from '../domain/models/Branch';
import { CommitRow } from '../domain/models/GraphElements';
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
    graphRows: Array<{
        index: number;
        commitX: number;
        commitY: number;
        commitColor: string;
        branchLines: Array<{
            x: number;
            startY: number;
            endY: number;
            color: string;
            opacity: number;
        }>;
        connectionLines: Array<{
            startX: number;
            startY: number;
            endX: number;
            endY: number;
            color: string;
            hasArrow: boolean;
        }>;
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
        const commitRows = await this.generateGraphUseCase.execute();
        
        console.log('[DEBUG] GitGraphWebviewController - Repository commits:', repository.commits.length);
        console.log('[DEBUG] GitGraphWebviewController - Generated commit rows:', commitRows.length);
        console.log('[DEBUG] GitGraphWebviewController - First commit:', repository.commits[0]?.hash);
        console.log('[DEBUG] GitGraphWebviewController - First row:', commitRows[0]);
        
        return {
            commits: repository.commits.map(this.mapCommitToDTO),
            branches: repository.branches.map(this.mapBranchToDTO),
            graphRows: commitRows.map(this.mapCommitRowToDTO)
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

    private mapCommitRowToDTO(row: CommitRow) {
        console.log(`[DEBUG] mapCommitRowToDTO - Raw row:`, {
            index: row.index,
            centerX: row.commitNode.centerX,
            centerY: row.commitNode.centerY,
            color: row.commitNode.color.value,
            branchLinesCount: row.branchLines.length,
            connectionLinesCount: row.connectionLines.length
        });
        
        const result = {
            index: row.index,
            commitX: row.commitNode.centerX,
            commitY: row.commitNode.centerY,
            commitColor: row.commitNode.color.value,
            branchLines: row.branchLines.map(line => ({
                x: line.bounds.x,
                startY: line.bounds.y,
                endY: line.bounds.y + line.bounds.height,
                color: line.color.value,
                opacity: line.opacity
            })),
            connectionLines: row.connectionLines.map(line => ({
                startX: line.startPoint.x,
                startY: line.startPoint.y,
                endX: line.endPoint.x,  
                endY: line.endPoint.y,
                color: line.color.value,
                hasArrow: line.hasArrow
            }))
        };
        
        console.log(`[DEBUG] mapCommitRowToDTO - Mapped result:`, result);
        return result;
    }
}