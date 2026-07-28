import { describe, expect, test } from 'vitest';
import {
    baseName,
    isInside,
    joinPath,
    normalizePath,
    parentPath,
    relativePathFrom,
} from './paths';

describe('normalizePath', () => {
    test('drops trailing separators but keeps the root', () => {
        expect(normalizePath('/a/b/')).toBe('/a/b');
        expect(normalizePath('/a/b')).toBe('/a/b');
        expect(normalizePath('/a/b///')).toBe('/a/b');
        expect(normalizePath('/')).toBe('/');
    });
});

describe('baseName', () => {
    test('is the last segment, whatever the separator', () => {
        expect(baseName('/a/b/repo')).toBe('repo');
        expect(baseName('/a/b/repo/')).toBe('repo');
        expect(baseName('C:\\work\\repo')).toBe('repo');
    });
});

describe('parentPath', () => {
    test('is the containing directory', () => {
        expect(parentPath('/projects/gitgrit')).toBe('/projects');
        expect(parentPath('/projects/gitgrit/')).toBe('/projects');
        expect(parentPath('C:\\work\\repo')).toBe('C:\\work');
    });

    test('keeps the separator for a child of the root', () => {
        // Otherwise /repo's parent would be the empty string, and joining onto
        // it would produce a relative path.
        expect(parentPath('/repo')).toBe('/');
    });

    test('a path with no separator is its own parent', () => {
        expect(parentPath('repo')).toBe('repo');
    });
});

describe('joinPath', () => {
    test('joins with a single separator regardless of a trailing one', () => {
        expect(joinPath('/projects', 'repo')).toBe('/projects/repo');
        expect(joinPath('/projects/', 'repo')).toBe('/projects/repo');
    });
});

describe('isInside', () => {
    test('a prefix is not the same as being inside a directory', () => {
        expect(isInside('/a/b', '/a/b/c')).toBe(true);
        expect(isInside('/a/b', '/a/b')).toBe(true);
        // The trap: /a/bc starts with /a/b but is a sibling.
        expect(isInside('/a/b', '/a/bc')).toBe(false);
    });

    test('handles a filesystem root, which already ends in a separator', () => {
        expect(isInside('/', '/anything')).toBe(true);
    });

    test('treats a backslash as a separator too', () => {
        expect(isInside('C:\\work', 'C:\\work\\api')).toBe(true);
    });
});

describe('relativePathFrom', () => {
    test('reports a relative path only for something actually inside', () => {
        expect(relativePathFrom('/w', '/w/apps/api')).toBe('apps/api');
        expect(relativePathFrom('/w', '/elsewhere')).toBeUndefined();
    });

    test('always joins with a forward slash', () => {
        expect(relativePathFrom('C:\\work', 'C:\\work\\apps\\api')).toBe(
            'apps/api'
        );
    });
});
