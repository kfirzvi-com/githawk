import { BranchLayoutService } from '../../../domain/services/BranchLayoutService';
import { Branch } from '../../../domain/models/Branch';

// Simple test structure
function describe(name: string, fn: () => void) {
    console.log(`\n${name}:`);
    fn();
}

function it(name: string, fn: () => void) {
    try {
        fn();
        console.log(`  ✓ ${name}`);
    } catch (error) {
        console.log(`  ✗ ${name}: ${error}`);
    }
}

function expect(actual: any) {
    return {
        toBe: (expected: any) => {
            if (actual !== expected) {
                throw new Error(`Expected ${expected}, got ${actual}`);
            }
        },
        toHaveLength: (expected: number) => {
            if (actual.length !== expected) {
                throw new Error(`Expected length ${expected}, got ${actual.length}`);
            }
        }
    };
}

describe('BranchLayoutService', () => {
    const service = new BranchLayoutService();

    it('should assign main branches to first columns', () => {
        const branches = [
            new Branch('feature/test', 'local', 'abc123'),
            new Branch('main', 'local', 'def456'),
            new Branch('develop', 'local', 'ghi789')
        ];

        const assignments = service.assignBranchPositionsAndColors(branches);
        
        expect(assignments).toHaveLength(3);
        
        // Main should be first
        const mainAssignment = assignments.find(a => a.branchName === 'main');
        expect(mainAssignment?.column).toBe(0);
        
        // Develop should be second
        const developAssignment = assignments.find(a => a.branchName === 'develop');
        expect(developAssignment?.column).toBe(1);
        
        // Feature should be last
        const featureAssignment = assignments.find(a => a.branchName === 'feature/test');
        expect(featureAssignment?.column).toBe(2);
    });

    it('should calculate standard dimensions', () => {
        expect(service.calculateColumnWidth()).toBe(25);
        expect(service.calculateRowHeight()).toBe(50);
    });
});