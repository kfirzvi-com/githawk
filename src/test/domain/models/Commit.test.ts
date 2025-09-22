import { Commit } from '../../../domain/models/Commit';

// Simple test structure (would normally use Jest or similar)
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
        toThrow: (message?: string) => {
            try {
                if (typeof actual === 'function') {
                    actual();
                }
                throw new Error('Expected function to throw');
            } catch (error) {
                if (message && !String(error).includes(message)) {
                    throw new Error(`Expected error to contain "${message}", got "${error}"`);
                }
            }
        }
    };
}

describe('Commit', () => {
    it('should create a commit with valid data', () => {
        const commit = new Commit(
            'abc123',
            'Initial commit',
            'John Doe',
            [],
            ['main']
        );

        expect(commit.hash).toBe('abc123');
        expect(commit.message).toBe('Initial commit');
        expect(commit.author).toBe('John Doe');
        expect(commit.shortHash).toBe('abc123');
        expect(commit.isInitialCommit).toBe(true);
        expect(commit.isMergeCommit).toBe(false);
    });

    it('should throw error for empty hash', () => {
        expect(() => {
            new Commit('', 'message', 'author', [], []);
        }).toThrow('Commit hash cannot be empty');
    });

    it('should throw error for empty message', () => {
        expect(() => {
            new Commit('abc123', '', 'author', [], []);
        }).toThrow('Commit message cannot be empty');
    });

    it('should identify merge commits correctly', () => {
        const mergeCommit = new Commit(
            'abc123',
            'Merge branch feature',
            'John Doe',
            ['parent1', 'parent2'],
            []
        );

        expect(mergeCommit.isMergeCommit).toBe(true);
        expect(mergeCommit.isInitialCommit).toBe(false);
        expect(mergeCommit.primaryParentHash).toBe('parent1');
    });

    it('should check branch membership correctly', () => {
        const commit = new Commit(
            'abc123',
            'Feature commit',
            'John Doe',
            ['parent1'],
            ['feature/awesome'],
            'feature/awesome'
        );

        expect(commit.hasBranch('feature/awesome')).toBe(true);
        expect(commit.hasBranch('main')).toBe(false);
    });

    it('should generate correct short hash', () => {
        const commit = new Commit(
            'abcdef123456',
            'Test commit',
            'Author',
            [],
            []
        );

        expect(commit.shortHash).toBe('abcdef12');
    });
});