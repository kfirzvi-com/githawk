import { describe, expect, test } from 'vitest';
import {
    DirectoryNode,
    TreeNode,
    buildComparisonTree,
    buildTree,
    countFiles,
    describeChange,
    filesBeneath,
    markdownTooltipSource,
} from './changedFilesTreeModel';
import {
    ComparisonDto,
    FileChangeDto,
} from '../../application/dto/ComparisonDto';

const file = (path: string, overrides: Partial<FileChangeDto> = {}): FileChangeDto => ({
    path,
    status: 'modified',
    insertions: 1,
    deletions: 1,
    isBinary: false,
    ...overrides,
});

const labels = (nodes: TreeNode[]) =>
    nodes.map((node) => (node.kind === 'file' ? node.change.path : node.label));

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

describe('countFiles', () => {
    test('counts a single file', () => {
        expect(
            countFiles({ kind: 'file', change: file('a.ts'), baseRev: 'HEAD' })
        ).toBe(1);
    });

    test('counts files nested at any depth', () => {
        const tree = buildTree([
            file('src/a.ts'),
            file('src/deep/b.ts'),
            file('src/deep/deeper/c.ts'),
        ]);

        expect(countFiles(tree[0])).toBe(3);
    });
});

describe('markdownTooltipSource', () => {
    test('states the status and the path', () => {
        const source = markdownTooltipSource(file('src/a.ts'));

        expect(source).toContain('**Modified**');
        expect(source).toContain('src/a.ts');
        expect(source).toContain('+1');
    });

    test('names the previous path for a rename', () => {
        const source = markdownTooltipSource(
            file('new.ts', { status: 'renamed', previousPath: 'old.ts' })
        );

        expect(source).toContain('**Renamed**');
        expect(source).toContain('renamed from');
        expect(source).toContain('old.ts');
    });

    test('says binary rather than showing counts', () => {
        const source = markdownTooltipSource(
            file('blob.bin', { isBinary: true, insertions: 0, deletions: 0 })
        );

        expect(source).toContain('binary');
        expect(source).not.toContain('+0');
    });
});

describe('buildComparisonTree', () => {
    const comparison = (
        overrides: Partial<ComparisonDto> = {}
    ): ComparisonDto => ({
        label: 'x',
        method: 'direct',
        methodExplanation: '',
        files: [],
        totals: { files: 0, insertions: 0, deletions: 0, binaryFiles: 0 },
        baseRev: 'abc',
        targetRev: 'def',
        skipped: [],
        ...overrides,
    });

    test('a comparison without groups starts at the directories', () => {
        const tree = buildComparisonTree(
            comparison({ files: [file('src/a.ts'), file('b.ts')] })
        );

        expect(tree.map((node) => node.kind)).toEqual(['directory', 'file']);
        // Every row opens the comparison's own two revisions.
        const rows = tree.flatMap(filesBeneath);
        expect(rows.map((row) => [row.baseRev, row.targetRev])).toEqual([
            ['abc', 'def'],
            ['abc', 'def'],
        ]);
        expect(rows.every((row) => row.group === undefined)).toBe(true);
    });

    /**
     * The working tree keeps git's own sections, and each row opens the
     * diff its section means: HEAD against the index for a staged file, the
     * index against the disk for an unstaged one. One pair for the whole
     * tree would open the wrong diff for half the rows.
     */
    test("the working tree is sectioned, and each row carries its section's revisions", () => {
        const tree = buildComparisonTree(
            comparison({
                method: 'workingTree',
                groups: [
                    {
                        kind: 'staged',
                        files: [file('src/staged.ts')],
                        baseRev: 'HEAD',
                        targetRev: ':0',
                    },
                    {
                        kind: 'unstaged',
                        files: [file('src/edited.ts')],
                        baseRev: ':0',
                    },
                    {
                        kind: 'untracked',
                        files: [file('new.ts', { status: 'untracked' })],
                        baseRev: 'HEAD',
                    },
                ],
            })
        );

        expect(labels(tree)).toEqual([
            'Staged Changes',
            'Changes',
            'Untracked Files',
        ]);

        const staged = filesBeneath(tree[0])[0];
        expect(staged.group).toBe('staged');
        expect([staged.baseRev, staged.targetRev]).toEqual(['HEAD', ':0']);

        const edited = filesBeneath(tree[1])[0];
        expect(edited.group).toBe('unstaged');
        expect([edited.baseRev, edited.targetRev]).toEqual([':0', undefined]);

        const untracked = filesBeneath(tree[2])[0];
        expect(untracked.group).toBe('untracked');
        expect(untracked.targetRev).toBeUndefined();
    });

    test('a file both staged and edited again appears in both sections', () => {
        const tree = buildComparisonTree(
            comparison({
                groups: [
                    { kind: 'staged', files: [file('a.ts')], baseRev: 'HEAD', targetRev: ':0' },
                    { kind: 'unstaged', files: [file('a.ts')], baseRev: ':0' },
                ],
            })
        );

        expect(tree.flatMap(filesBeneath).map((row) => row.group)).toEqual([
            'staged',
            'unstaged',
        ]);
    });
});

describe('untracked files', () => {
    test('are described by their status, having no counts', () => {
        expect(describeChange(file('new.ts', { status: 'untracked', insertions: 0, deletions: 0 }))).toBe(
            'Untracked'
        );
    });

    test('are explained in the tooltip rather than given zero counts', () => {
        const source = markdownTooltipSource(
            file('new.ts', { status: 'untracked', insertions: 0, deletions: 0 })
        );

        expect(source).toContain('**Untracked**');
        expect(source).toContain('stage it');
        expect(source).not.toContain('+0');
    });
});
