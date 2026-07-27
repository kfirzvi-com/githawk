import { describe, expect, test } from 'vitest';
import {
    DirectoryNode,
    TreeNode,
    buildTree,
    describeChange,
} from './changedFilesTreeModel';
import { FileChangeDto } from '../../application/dto/ComparisonDto';

const file = (path: string, overrides: Partial<FileChangeDto> = {}): FileChangeDto => ({
    path,
    status: 'modified',
    insertions: 1,
    deletions: 1,
    isBinary: false,
    ...overrides,
});

const labels = (nodes: TreeNode[]) =>
    nodes.map((node) => (node.kind === 'directory' ? node.label : node.change.path));

const directory = (nodes: TreeNode[], label: string): DirectoryNode => {
    const found = nodes.find(
        (node): node is DirectoryNode =>
            node.kind === 'directory' && node.label === label
    );
    if (!found) {
        throw new Error(`no directory ${label} in ${labels(nodes).join(', ')}`);
    }
    return found;
};

describe('buildTree', () => {
    test('puts a root-level file at the top level', () => {
        const tree = buildTree([file('README.md')]);

        expect(tree).toHaveLength(1);
        expect(tree[0].kind).toBe('file');
    });

    test('groups files by directory', () => {
        const tree = buildTree([
            file('src/a.ts'),
            file('src/b.ts'),
            file('docs/c.md'),
        ]);

        expect(labels(tree)).toEqual(['docs', 'src']);
        expect(directory(tree, 'src').children).toHaveLength(2);
    });

    test('collapses a chain of single-child directories', () => {
        const tree = buildTree([file('src/domain/models/Commit.ts')]);

        // One node rather than three nested levels, as the explorer does.
        expect(labels(tree)).toEqual(['src/domain/models']);
        expect(directory(tree, 'src/domain/models').children).toHaveLength(1);
    });

    test('stops collapsing where a directory branches', () => {
        const tree = buildTree([
            file('src/domain/models/Commit.ts'),
            file('src/domain/services/Layout.ts'),
        ]);

        expect(labels(tree)).toEqual(['src/domain']);
        const domain = directory(tree, 'src/domain');
        expect(labels(domain.children)).toEqual(['models', 'services']);
    });

    test('does not collapse past a file sitting alongside a directory', () => {
        const tree = buildTree([
            file('src/index.ts'),
            file('src/domain/Commit.ts'),
        ]);

        // `src` holds both a directory and a file, so collapsing it into
        // `src/domain` would hide index.ts.
        expect(labels(tree)).toEqual(['src']);
        const src = directory(tree, 'src');
        expect(labels(src.children)).toEqual(['domain', 'src/index.ts']);
    });

    test('lists directories before files, each alphabetically', () => {
        const tree = buildTree([
            file('z.txt'),
            file('a.txt'),
            file('beta/one.txt'),
            file('alpha/two.txt'),
        ]);

        expect(labels(tree)).toEqual(['alpha', 'beta', 'a.txt', 'z.txt']);
    });

    test('keeps deeply nested siblings apart', () => {
        const tree = buildTree([
            file('a/b/c/one.ts'),
            file('a/b/d/two.ts'),
        ]);

        const ab = directory(tree, 'a/b');
        expect(labels(ab.children)).toEqual(['c', 'd']);
    });

    test('handles an empty comparison', () => {
        expect(buildTree([])).toEqual([]);
    });

    test('handles a path with spaces and quotes', () => {
        const awkward = 'src/a file with "quotes".ts';
        const tree = buildTree([file(awkward)]);

        const src = directory(tree, 'src');
        expect(src.children).toHaveLength(1);
        expect(
            src.children[0].kind === 'file' && src.children[0].change.path
        ).toBe(awkward);
    });
});

describe('describeChange', () => {
    test('shows insertions and deletions', () => {
        expect(describeChange(file('a', { insertions: 12, deletions: 3 }))).toBe(
            '+12 −3'
        );
    });

    test('omits a zero side', () => {
        expect(describeChange(file('a', { insertions: 5, deletions: 0 }))).toBe(
            '+5'
        );
        expect(describeChange(file('a', { insertions: 0, deletions: 7 }))).toBe(
            '−7'
        );
    });

    test('says binary rather than inventing zero counts', () => {
        expect(
            describeChange(
                file('a', { insertions: 0, deletions: 0, isBinary: true })
            )
        ).toBe('binary');
    });

    test('falls back to the status when nothing changed textually', () => {
        expect(
            describeChange(
                file('a', { insertions: 0, deletions: 0, status: 'renamed' })
            )
        ).toBe('Renamed');
    });
});
