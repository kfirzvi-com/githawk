import { Commit } from '../models/Commit';
import { GitRepository } from '../models/GitRepository';
import { CommitRow, CommitNode, BranchLine, ConnectionLine, Point, BoundingBox } from '../models/GraphElements';
import { BranchLayoutService, BranchColorAssignment } from './BranchLayoutService';
import { Color } from '../models/Color';

export interface BranchLifetime {
    start: number;
    end: number;
}

export class GitGraphService {
    constructor(
        private readonly branchLayoutService: BranchLayoutService
    ) {}

    generateGraph(repository: GitRepository): CommitRow[] {
        const commits = repository.commits;
        console.log('[DEBUG] GitGraphService - Input commits:', commits.length);
        console.log('[DEBUG] GitGraphService - First commit:', commits[0]?.hash);
        
        const branchAssignments = this.branchLayoutService.assignBranchPositionsAndColors(repository.branches);
        console.log('[DEBUG] GitGraphService - Branch assignments:', branchAssignments.length);
        
        const branchPositions = new Map(branchAssignments.map(a => [a.branchName, a.column]));
        const branchColors = new Map(branchAssignments.map(a => [a.branchName, a.color]));
        
        const columnWidth = this.branchLayoutService.calculateColumnWidth();
        const rowHeight = this.branchLayoutService.calculateRowHeight();
        
        const result = commits.map((commit, index) => {
            return this.createCommitRow(
                commit,
                index,
                commits,
                repository,
                branchPositions,
                branchColors,
                columnWidth,
                rowHeight
            );
        });
        
        console.log('[DEBUG] GitGraphService - Generated rows:', result.length);
        console.log('[DEBUG] GitGraphService - First row:', result[0]);
        
        return result;
    }

    private createCommitRow(
        commit: Commit,
        index: number,
        allCommits: Commit[],
        repository: GitRepository,
        branchPositions: Map<string, number>,
        branchColors: Map<string, Color>,
        columnWidth: number,
        rowHeight: number
    ): CommitRow {
        const branchName = commit.branchHint || 'main';
        const column = branchPositions.get(branchName) || 0;
        const color = branchColors.get(branchName) || Color.MAIN_BLUE;
        
        // Create commit node
        const commitX = column * columnWidth + 15;
        const commitY = index * rowHeight + 25;
        const radius = commit.isMergeCommit ? 5 : 4;
        const strokeWidth = commit.isInitialCommit ? 2 : 1;
        
        const commitNode = new CommitNode(
            `commit-${commit.shortHash}`,
            { x: commitX - radius, y: commitY - radius, width: radius * 2, height: radius * 2 },
            commit.hash,
            this.getCommitColor(commit, allCommits, branchColors),
            radius,
            strokeWidth
        );

        // Create branch lines
        const branchLines = this.createBranchLines(
            index,
            allCommits,
            branchPositions,
            branchColors,
            columnWidth,
            rowHeight
        );

        // Create connection lines
        const connectionLines = this.createConnectionLines(
            commit,
            index,
            allCommits,
            repository,
            branchPositions,
            branchColors,
            columnWidth,
            rowHeight
        );

        return new CommitRow(index, commitNode, branchLines, connectionLines);
    }

    private getCommitColor(
        commit: Commit,
        allCommits: Commit[],
        branchColors: Map<string, Color>
    ): Color {
        const branchName = commit.branchHint || 'main';
        let color = branchColors.get(branchName) || Color.MAIN_BLUE;

        // For merge commits, use color from primary parent
        if (commit.isMergeCommit && commit.primaryParentHash) {
            const primaryParent = allCommits.find(c => c.hash === commit.primaryParentHash);
            if (primaryParent && primaryParent.branchHint) {
                const parentColor = branchColors.get(primaryParent.branchHint);
                if (parentColor) {
                    color = parentColor;
                }
            }
        }

        return color;
    }

    private createBranchLines(
        currentIndex: number,
        allCommits: Commit[],
        branchPositions: Map<string, number>,
        branchColors: Map<string, Color>,
        columnWidth: number,
        rowHeight: number
    ): BranchLine[] {
        const lines: BranchLine[] = [];
        const maxColumns = branchPositions.size;

        for (let column = 0; column < maxColumns; column++) {
            const branchName = Array.from(branchPositions.keys())[column];
            if (!branchName) {
                continue;
            }

            if (this.shouldDrawBranchLineAt(branchName, currentIndex, allCommits)) {
                const x = column * columnWidth + 15;
                const y = currentIndex * rowHeight;
                const color = branchColors.get(branchName) || Color.MAIN_BLUE;
                const currentCommit = allCommits[currentIndex];
                const isCurrentBranch = currentCommit.branchHint === branchName;

                const line = new BranchLine(
                    `branch-line-${branchName}-${currentIndex}`,
                    { x, y, width: 0, height: rowHeight },
                    color,
                    1.5,
                    isCurrentBranch ? 0.6 : 0.4
                );
                lines.push(line);
            }
        }

        return lines;
    }

    private createConnectionLines(
        commit: Commit,
        index: number,
        allCommits: Commit[],
        repository: GitRepository,
        branchPositions: Map<string, number>,
        branchColors: Map<string, Color>,
        columnWidth: number,
        rowHeight: number
    ): ConnectionLine[] {
        const lines: ConnectionLine[] = [];
        const currentBranchName = commit.branchHint || 'main';
        const currentColumn = branchPositions.get(currentBranchName) || 0;
        const commitX = currentColumn * columnWidth + 15;
        const commitY = index * rowHeight + 25;

        for (const parentHash of commit.parentHashes) {
            const parentIndex = allCommits.findIndex(c => c.hash === parentHash);
            if (parentIndex > index) { // Parent is below in the list (chronologically earlier)
                const parentCommit = allCommits[parentIndex];
                const parentBranchName = parentCommit.branchHint || 'main';
                const parentColumn = branchPositions.get(parentBranchName) || 0;
                const parentX = parentColumn * columnWidth + 15;
                const parentY = parentIndex * rowHeight + 25;

                if (parentX !== commitX) {
                    const color = commit.isMergeCommit 
                        ? Color.MERGE_ORANGE 
                        : (branchColors.get(currentBranchName) || Color.MAIN_BLUE);
                    
                    const line = new ConnectionLine(
                        `connection-${commit.shortHash}-${parentCommit.shortHash}`,
                        { 
                            x: Math.min(parentX, commitX), 
                            y: Math.min(parentY, commitY), 
                            width: Math.abs(parentX - commitX), 
                            height: Math.abs(parentY - commitY) 
                        },
                        { x: parentX, y: parentY },
                        { x: commitX, y: commitY },
                        color,
                        1.5,
                        commit.isMergeCommit ? 0.7 : 0.6,
                        commit.isMergeCommit
                    );
                    lines.push(line);
                }
            }
        }

        return lines;
    }

    private shouldDrawBranchLineAt(branchName: string, commitIndex: number, commits: Commit[]): boolean {
        const commit = commits[commitIndex];
        
        // Always draw for the commit's own branch (handled in rendering with spacing)
        if (commit.branchHint === branchName) {
            return true;
        }
        
        // Get basic branch lifetime
        const lifetime = this.getBranchLifetime(branchName, commits);
        if (lifetime.start === -1) {
            return false;
        }
        
        // Find where this branch gets merged
        let branchMergePoint = -1;
        for (let i = 0; i < commits.length; i++) {
            const mergeCommit = commits[i];
            if (mergeCommit.isMergeCommit) {
                const mergesFromThisBranch = mergeCommit.parentHashes.some(parentHash => {
                    const parentCommit = commits.find(c => c.hash === parentHash);
                    return parentCommit && parentCommit.branchHint === branchName;
                });
                if (mergesFromThisBranch) {
                    branchMergePoint = i;
                    break;
                }
            }
        }
        
        // Determine the range where we should draw lines
        let startPoint = lifetime.start;
        const endPoint = lifetime.end;
        
        // If this branch gets merged, extend the line to the merge point
        if (branchMergePoint !== -1 && branchMergePoint < startPoint) {
            startPoint = branchMergePoint;
        }
        
        // Draw line if we're within the extended range and there are commits above
        const withinRange = commitIndex >= startPoint && commitIndex <= endPoint;
        const hasCommitAbove = commitIndex > startPoint;
        
        return withinRange && hasCommitAbove;
    }

    private getBranchLifetime(branchName: string, commits: Commit[]): BranchLifetime {
        let start = commits.length;
        let end = -1;
        
        commits.forEach((commit, index) => {
            if (commit.hasBranch(branchName)) {
                start = Math.min(start, index);
                end = Math.max(end, index);
            }
        });
        
        // If no commits found, return invalid range
        if (start === commits.length) {
            return { start: -1, end: -1 };
        }
        
        // For branches that originate from another branch, adjust the visual start
        // to begin one row after the parent commit
        if (start < commits.length) {
            const firstCommit = commits[start];
            
            // Check if this branch's first commit has a parent from a different branch
            if (firstCommit.parentHashes.length > 0) {
                const parentHash = firstCommit.parentHashes[0]; // Take the first parent
                const parentIndex = commits.findIndex(c => c.hash === parentHash);
                
                if (parentIndex !== -1) {
                    const parentCommit = commits[parentIndex];
                    const parentBranch = parentCommit.branchHint || 'main';
                    
                    // If the parent is from a different branch, start the visual line
                    // one row after the parent (which means one row before the parent's index)
                    if (parentBranch !== branchName && parentIndex > 0) {
                        start = parentIndex - 1;
                    }
                }
            }
        }
        
        return { start, end };
    }
}