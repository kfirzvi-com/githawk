import { describe, expect, test } from 'vitest';
import {
    chooseActiveRepository,
    containingRepository,
    describeRepositories,
    isInside,
    normalizePath,
    relativePathFrom,
    shouldDescendInto,
} from './repositoryDiscovery';

describe('shouldDescendInto', () => {
    test('skips dot-directories, .git among them', () => {
        expect(shouldDescendInto('.git')).toBe(false);
        expect(shouldDescendInto('.venv')).toBe(false);
        expect(shouldDescendInto('.terraform')).toBe(false);
    });

    test('skips the directories that make a deep scan expensive', () => {
        expect(shouldDescendInto('node_modules')).toBe(false);
        expect(shouldDescendInto('dist')).toBe(false);
        expect(shouldDescendInto('target')).toBe(false);
    });

    test('matches the ignore list case-insensitively', () => {
        // macOS and Windows would otherwise let Node_Modules through.
        expect(shouldDescendInto('Node_Modules')).toBe(false);
        expect(shouldDescendInto('Pods')).toBe(false);
    });

    test('descends into anything else', () => {
        expect(shouldDescendInto('apps')).toBe(true);
        expect(shouldDescendInto('packages')).toBe(true);
        expect(shouldDescendInto('outbound')).toBe(true);
    });
});

describe('path helpers', () => {
    test('normalizes away trailing separators but keeps the root', () => {
        expect(normalizePath('/a/b/')).toBe('/a/b');
        expect(normalizePath('/a/b')).toBe('/a/b');
        expect(normalizePath('/')).toBe('/');
    });

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
        expect(relativePathFrom('C:\\work', 'C:\\work\\api')).toBe('api');
    });

    test('reports a relative path only for something actually inside', () => {
        expect(relativePathFrom('/w', '/w/apps/api')).toBe('apps/api');
        expect(relativePathFrom('/w', '/elsewhere')).toBeUndefined();
    });
});

describe('describeRepositories', () => {
    test('names each repository after its own directory', () => {
        const described = describeRepositories(['/w/apps/api'], ['/w']);

        expect(described).toEqual([
            { root: '/w/apps/api', name: 'api', description: 'apps/api' },
        ]);
    });

    test('gives the opened folder itself no description', () => {
        // There is nothing to add: the repository is the workspace.
        expect(describeRepositories(['/w'], ['/w'])).toEqual([
            { root: '/w', name: 'w', description: undefined },
        ]);
    });

    test('sorts by path so "the first repository" is a stable default', () => {
        const described = describeRepositories(
            ['/w/tools/cli', '/w/apps/api', '/w/web'],
            ['/w']
        );

        expect(described.map((r) => r.root)).toEqual([
            '/w/apps/api',
            '/w/tools/cli',
            '/w/web',
        ]);
    });

    test('deduplicates, including paths that differ only by a trailing slash', () => {
        const described = describeRepositories(['/w/api/', '/w/api'], ['/w']);

        expect(described).toHaveLength(1);
        expect(described[0].root).toBe('/w/api');
    });

    test('two repositories with the same name are told apart by their path', () => {
        const described = describeRepositories(
            ['/w/apps/api', '/w/legacy/api'],
            ['/w']
        );

        expect(described.map((r) => r.name)).toEqual(['api', 'api']);
        expect(described.map((r) => r.description)).toEqual([
            'apps/api',
            'legacy/api',
        ]);
    });

    test('a multi-root workspace names the folder each repository came from', () => {
        const described = describeRepositories(
            ['/one/api', '/two/api'],
            ['/one', '/two']
        );

        expect(described.map((r) => r.description)).toEqual([
            'one/api',
            'two/api',
        ]);
    });

    test('a nested workspace folder owns the repository, not its parent', () => {
        const described = describeRepositories(
            ['/w/apps/api'],
            ['/w', '/w/apps']
        );

        // Described relative to /w/apps, the closest folder that contains it.
        expect(described[0].description).toBe('apps/api');
    });

    test('falls back to the full path for something outside every folder', () => {
        const described = describeRepositories(['/elsewhere/api'], ['/w']);

        expect(described[0].description).toBe('/elsewhere/api');
    });
});

describe('containingRepository', () => {
    const repositories = describeRepositories(
        ['/w/app', '/w/app/vendor/lib'],
        ['/w']
    );

    test('picks the deepest repository containing the file', () => {
        // A submodule owns its own files, not the superproject.
        expect(
            containingRepository(repositories, '/w/app/vendor/lib/src/x.ts')
                ?.root
        ).toBe('/w/app/vendor/lib');
    });

    test('picks the outer one for a file outside the nested repository', () => {
        expect(
            containingRepository(repositories, '/w/app/src/x.ts')?.root
        ).toBe('/w/app');
    });

    test('returns nothing for a file in no repository', () => {
        expect(
            containingRepository(repositories, '/elsewhere/x.ts')
        ).toBeUndefined();
    });
});

describe('chooseActiveRepository', () => {
    const repositories = describeRepositories(
        ['/w/api', '/w/web'],
        ['/w']
    );

    test('honours what was chosen last time', () => {
        expect(
            chooseActiveRepository(repositories, { preferredRoot: '/w/web' })
                ?.root
        ).toBe('/w/web');
    });

    test('an explicit choice outranks the open file', () => {
        // Otherwise switching repository would be undone by clicking a file.
        const chosen = chooseActiveRepository(repositories, {
            preferredRoot: '/w/web',
            activeFilePath: '/w/api/src/main.ts',
        });

        expect(chosen?.root).toBe('/w/web');
    });

    test('falls back to the repository the open file is in', () => {
        const chosen = chooseActiveRepository(repositories, {
            activeFilePath: '/w/api/src/main.ts',
        });

        expect(chosen?.root).toBe('/w/api');
    });

    test('ignores a remembered repository that no longer exists', () => {
        const chosen = chooseActiveRepository(repositories, {
            preferredRoot: '/w/deleted',
            activeFilePath: '/w/web/index.html',
        });

        expect(chosen?.root).toBe('/w/web');
    });

    test('falls back to the first when there is nothing to go on', () => {
        expect(chooseActiveRepository(repositories)?.root).toBe('/w/api');
    });

    test('has nothing to choose when nothing was found', () => {
        expect(chooseActiveRepository([])).toBeUndefined();
    });
});
