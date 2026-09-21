import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GitCliTreeReader } from './GitCliTreeReader';
import { lsTreeArgs, resolveRevisionArgs } from './gitCommands';
import { TemporaryRepository } from './testing/temporaryRepository';

const repos: TemporaryRepository[] = [];

function newRepo(): TemporaryRepository {
    const repo = TemporaryRepository.create();
    repos.push(repo);
    return repo;
}

afterEach(() => {
    while (repos.length) {
        repos.pop()!.dispose();
    }
});

function commitFile(repo: TemporaryRepository, path: string, message: string): string {
    mkdirSync(join(repo.path, path, '..'), { recursive: true });
    writeFileSync(join(repo.path, path), `${message}\n`);
    repo.git(['add', path]);
    repo.git(['commit', '-m', message]);
    return repo.head();
}

describe('arguments', () => {
    test('recurse, NUL-delimited, names only, revision after the flags', () => {
        expect(lsTreeArgs('abc')).toEqual([
            'ls-tree', '-r', '-z', '--name-only', 'abc', '--',
        ]);
    });

    test('resolves to a commit and refuses to guess', () => {
        expect(resolveRevisionArgs('main')).toEqual([
            'rev-parse', '--verify', '--end-of-options', 'main^{commit}',
        ]);
    });
});

describe('GitCliTreeReader', () => {
    test('lists every file at a revision, not just the ones it changed', async () => {
        const repo = newRepo();
        commitFile(repo, 'README.md', 'first');
        const second = commitFile(repo, 'src/app/main.ts', 'second');
        commitFile(repo, 'src/app/later.ts', 'third');

        const paths = await new GitCliTreeReader(repo.path).listPaths(second);

        expect(paths.sort()).toEqual(['README.md', 'src/app/main.ts']);
    });

    test('keeps a path that contains a newline whole', async () => {
        const repo = newRepo();
        const odd = 'odd\nname.txt';
        commitFile(repo, odd, 'odd');

        const paths = await new GitCliTreeReader(repo.path).listPaths('HEAD');

        expect(paths).toEqual([odd]);
    });

    test('resolves a branch and a tag to the commit hash', async () => {
        const repo = newRepo();
        const hash = commitFile(repo, 'a.txt', 'a');
        repo.tag('v1');

        const reader = new GitCliTreeReader(repo.path);
        expect(await reader.resolve('main')).toBe(hash);
        expect(await reader.resolve('v1')).toBe(hash);
        expect(await reader.resolve(hash.slice(0, 8))).toBe(hash);
    });

    test('rejects a name that is not a revision', async () => {
        const repo = newRepo();
        commitFile(repo, 'a.txt', 'a');

        await expect(
            new GitCliTreeReader(repo.path).resolve('no-such-thing')
        ).rejects.toThrow();
    });
});
