import { Branch } from '../models/Branch';
import { Color } from '../models/Color';

export interface BranchColorAssignment {
    branchName: string;
    column: number;
    color: Color;
}

export class BranchLayoutService {
    private static readonly MAIN_COLORS = [
        Color.MAIN_BLUE,     // main/master
        Color.DEVELOP_GREEN, // develop
        Color.fromHex('#DC3545'), // hotfix
        Color.fromHex('#6F42C1')  // release
    ];

    private static readonly FEATURE_COLORS = [
        Color.FEATURE_ORANGE,
        Color.fromHex('#17A2B8'),
        Color.fromHex('#FFC107'),
        Color.fromHex('#E83E8C'),
        Color.fromHex('#20C997'),
        Color.fromHex('#6C757D')
    ];

    assignBranchPositionsAndColors(branches: Branch[]): BranchColorAssignment[] {
        const assignments: BranchColorAssignment[] = [];
        let mainColorIndex = 0;
        let featureColorIndex = 0;
        let nextColumn = 0;

        // Sort branches by priority: main branches first, then features
        const sortedBranches = this.sortBranchesByPriority(branches);
        
        for (const branch of sortedBranches) {
            const isMainBranch = this.isMainBranch(branch.name);
            const color = isMainBranch 
                ? BranchLayoutService.MAIN_COLORS[mainColorIndex++ % BranchLayoutService.MAIN_COLORS.length]
                : BranchLayoutService.FEATURE_COLORS[featureColorIndex++ % BranchLayoutService.FEATURE_COLORS.length];

            assignments.push({
                branchName: branch.name,
                column: nextColumn++,
                color: color
            });
        }

        return assignments;
    }

    private sortBranchesByPriority(branches: Branch[]): Branch[] {
        return branches
            .filter(b => b.isLocal) // Only local branches for now
            .sort((a, b) => {
                // Current branch first
                if (a.isCurrent && !b.isCurrent) {
                    return -1;
                }
                if (!a.isCurrent && b.isCurrent) {
                    return 1;
                }
                
                // Main branches before feature branches
                const aIsMain = this.isMainBranch(a.name);
                const bIsMain = this.isMainBranch(b.name);
                if (aIsMain && !bIsMain) {
                    return -1;
                }
                if (!aIsMain && bIsMain) {
                    return 1;
                }
                
                // Sort main branches in specific order
                if (aIsMain && bIsMain) {
                    return this.getMainBranchPriority(a.name) - this.getMainBranchPriority(b.name);
                }
                
                // Alphabetical for feature branches
                return a.name.localeCompare(b.name);
            });
    }

    private isMainBranch(branchName: string): boolean {
        const mainBranches = ['main', 'master', 'develop', 'release', 'hotfix'];
        return mainBranches.some(main => branchName === main || branchName.startsWith(main + '/'));
    }

    private getMainBranchPriority(branchName: string): number {
        if (branchName === 'main' || branchName === 'master') {
            return 0;
        }
        if (branchName === 'develop') {
            return 1;
        }
        if (branchName.startsWith('release/')) {
            return 2;
        }
        if (branchName.startsWith('hotfix/')) {
            return 3;
        }
        return 999;
    }

    calculateColumnWidth(): number {
        return 25; // Standard column width for Git graph
    }

    calculateRowHeight(): number {
        return 50; // Standard row height for commits
    }
}