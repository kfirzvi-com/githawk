import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { hunkFocusLine } from '../../domain/models/Hunk';
import { GitCliHunkReader } from './GitCliHunkReader';
import { fileHunksArgs } from './gitDiffCommands';
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

const numbered = (count: number, edit: (line: number) => string = String) =>
    Array.from({ length: count }, (_, index) => edit(index + 1)).join('\n') + '\n';

function commitFile(repo: TemporaryRepository, path: string, content: string): string {
    writeFileSync(join(repo.path, path), content);
    repo.git(['add', path]);
    repo.git(['commit', '-m', `write ${path}`]);
    return repo.head();
}

describe('arguments', () => {
    test('HEAD against the index is --cached', () => {
        expect(fileHunksArgs({ path: 'a', baseRev: 'HEAD', targetRev: ':0' })).toContain(
            '--cached'
        );
    });

    test('the index against the disk names no revision', () => {
        const args = fileHunksArgs({ path: 'a', baseRev: ':0' });
        expect(args.slice(args.indexOf('-U0') + 1)).toEqual(['--', 'a']);
    });

    test('a rename reads both names', () => {
        expect(
            fileHunksArgs({ path: 'new', previousPath: 'old', baseRev: 'a', targetRev: 'b' }).slice(-3)
        ).toEqual(['--', 'old', 'new']);
    });
});

describe('GitCliHunkReader', () => {
    test('reads each separate change in a file as its own hunk', async () => {
        const repo = newRepo();
        const before = commitFile(repo, 'list.txt', numbered(40));
        const after = commitFile(
            repo,
            'list.txt',
            numbered(40, (line) => (line === 5 || line === 30 ? `changed ${line}` : String(line)))
        );

        const hunks = await new GitCliHunkReader(repo.path).hunks({
            path: 'list.txt',
            baseRev: before,
            targetRev: after,
        });

        expect(hunks).toHaveLength(2);
        expect(hunks.map((hunk) => hunkFocusLine(hunk))).toEqual([5, 30]);
        expect(hunks[0].lines).toContain('+changed 5');
        expect(new Set(hunks.map((hunk) => hunk.id)).size).toBe(2);
    });

    test('two edits a few lines apart are two hunks, not one', async () => {
        const repo = newRepo();
        commitFile(repo, 'list.txt', numbered(40));
        writeFileSync(
            join(repo.path, 'list.txt'),
            numbered(40, (line) => (line === 10 || line === 13 ? 'changed' : String(line)))
        );

        const hunks = await new GitCliHunkReader(repo.path).hunks({
            path: 'list.txt',
            baseRev: ':0',
        });

        expect(hunks.map((hunk) => hunk.newStart)).toEqual([10, 13]);
    });

    test('names a hunk by the function it is in, without its opening brace', async () => {
        const repo = newRepo();
        const lines = ['function total(a, b) {', ...Array.from({ length: 8 }, (_, i) => `    const v${i} = ${i};`), '}', ''];
        const before = commitFile(repo, 'sum.js', lines.join('\n'));
        lines[7] = '    const v6 = 60;';
        const after = commitFile(repo, 'sum.js', lines.join('\n'));

        const [hunk] = await new GitCliHunkReader(repo.path).hunks({
            path: 'sum.js',
            baseRev: before,
            targetRev: after,
        });

        expect(hunk.context).toBe('function total(a, b)');
    });

    test('a hunk keeps its id when an edit above it moves it down', async () => {
        const repo = newRepo();
        commitFile(repo, 'list.txt', numbered(40));
        const reader = new GitCliHunkReader(repo.path);
        const read = () => reader.hunks({ path: 'list.txt', baseRev: ':0' });

        writeFileSync(
            join(repo.path, 'list.txt'),
            numbered(40, (line) => (line === 30 ? 'changed' : String(line)))
        );
        const [only] = await read();

        writeFileSync(
            join(repo.path, 'list.txt'),
            'inserted\n' + numbered(40, (line) => (line === 30 ? 'changed' : String(line)))
        );
        const moved = await read();

        expect(moved).toHaveLength(2);
        expect(moved[1].id).toBe(only.id);
        expect(moved[1].newStart).toBeGreaterThan(only.newStart);
    });

    test('staged and unstaged halves of one file are read from their own sides', async () => {
        const repo = newRepo();
        commitFile(repo, 'list.txt', numbered(40));
        const reader = new GitCliHunkReader(repo.path);

        writeFileSync(join(repo.path, 'list.txt'), numbered(40, (l) => (l === 3 ? 'staged' : String(l))));
        repo.git(['add', 'list.txt']);
        writeFileSync(
            join(repo.path, 'list.txt'),
            numbered(40, (l) => (l === 3 ? 'staged' : l === 35 ? 'unstaged' : String(l)))
        );

        const staged = await reader.hunks({ path: 'list.txt', baseRev: 'HEAD', targetRev: ':0' });
        const unstaged = await reader.hunks({ path: 'list.txt', baseRev: ':0' });

        expect(staged.flatMap((hunk) => hunk.lines)).toContain('+staged');
        expect(unstaged.flatMap((hunk) => hunk.lines)).toContain('+unstaged');
        expect(unstaged.flatMap((hunk) => hunk.lines)).not.toContain('+staged');
    });

    test('an untracked file is one hunk of everything in it', async () => {
        const repo = newRepo();
        commitFile(repo, 'README.md', 'hello\n');
        writeFileSync(join(repo.path, 'new.txt'), 'one\ntwo\n');

        const hunks = await new GitCliHunkReader(repo.path).hunks({
            path: 'new.txt',
            baseRev: 'HEAD',
            untracked: true,
        });

        expect(hunks).toHaveLength(1);
        expect(hunks[0]).toMatchObject({ newStart: 1, newLines: 2, lines: ['+one', '+two'] });
    });

    test('a binary file has no hunks', async () => {
        const repo = newRepo();
        const before = commitFile(repo, 'blob.bin', 'a\0b');
        const after = commitFile(repo, 'blob.bin', 'a\0c');

        expect(
            await new GitCliHunkReader(repo.path).hunks({
                path: 'blob.bin',
                baseRev: before,
                targetRev: after,
            })
        ).toEqual([]);
    });
});
