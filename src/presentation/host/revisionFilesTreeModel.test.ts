import { describe, expect, test } from 'vitest';
import {
    buildRevisionTree,
    countFiles,
    type RevisionDirectoryNode,
} from './revisionFilesTreeModel';

const REV = 'a'.repeat(40);

describe('buildRevisionTree', () => {
    test('nests files under their directories and carries the revision on each row', () => {
        const roots = buildRevisionTree(
            ['src/a.ts', 'src/b.ts', 'README.md'],
            REV
        );

        expect(roots.map((node) => node.kind)).toEqual(['directory', 'file']);
        const src = roots[0] as RevisionDirectoryNode;
        expect(src.label).toBe('src');
        expect(src.children).toEqual([
            { kind: 'file', path: 'src/a.ts', rev: REV },
            { kind: 'file', path: 'src/b.ts', rev: REV },
        ]);
    });

    test('compacts a chain of single-child directories into one row', () => {
        const roots = buildRevisionTree(['src/domain/models/Commit.ts'], REV);

        expect(roots).toHaveLength(1);
        const only = roots[0] as RevisionDirectoryNode;
        expect(only.label).toBe('src/domain/models');
        expect(only.path).toBe('src/domain/models');
        expect(only.children[0]).toEqual({
            kind: 'file',
            path: 'src/domain/models/Commit.ts',
            rev: REV,
        });
    });

    test('stops compacting where a directory has a file of its own', () => {
        const roots = buildRevisionTree(
            ['src/index.ts', 'src/lib/util.ts'],
            REV
        );

        const src = roots[0] as RevisionDirectoryNode;
        expect(src.label).toBe('src');
        expect(src.children.map((c) => c.kind)).toEqual(['directory', 'file']);
    });

    test('sorts directories before files, each alphabetically, whatever git said', () => {
        const roots = buildRevisionTree(
            ['zeta.txt', 'lib/x.ts', 'alpha.txt', 'app/y.ts'],
            REV
        );

        expect(
            roots.map((node) =>
                node.kind === 'directory' ? `${node.label}/` : node.path
            )
        ).toEqual(['app/', 'lib/', 'alpha.txt', 'zeta.txt']);
    });

    test('counts files beneath a compacted directory', () => {
        const roots = buildRevisionTree(
            ['src/a/one.ts', 'src/a/two.ts', 'src/a/deep/three.ts'],
            REV
        );

        expect(countFiles(roots[0])).toBe(3);
    });

    test('an empty revision is an empty tree', () => {
        expect(buildRevisionTree([], REV)).toEqual([]);
    });
});
