import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitCliBlameReader } from './GitCliBlameReader';
import { TemporaryRepository } from './testing/temporaryRepository';

describe('GitCliBlameReader', () => {
    let repo: TemporaryRepository | undefined;

    const write = (name: string, ...lines: string[]) =>
        writeFileSync(join(repo!.path, name), lines.join('\n') + '\n');

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    it('attributes a whole file to the commit that added it', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two', 'three');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'add the poem']);

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });

        expect(blame.blocks).toHaveLength(1);
        expect(blame.blocks[0]).toMatchObject({ startLine: 1, endLine: 3 });
        expect(blame.blocks[0].commit.author).toBe('Test Author');
        expect(blame.blocks[0].commit.summary).toBe('add the poem');
    });

    /**
     * The reason blocks exist. One commit editing the middle of a file gives
     * three runs, not three-lines-worth of identical labels.
     */
    it('splits a file into one block per run of lines', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two', 'three');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        write('poem.txt', 'one', 'CHANGED', 'three');
        repo.git(['commit', '-am', 'second']);

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });

        expect(
            blame.blocks.map((b) => [b.startLine, b.endLine, b.commit.summary])
        ).toEqual([
            [1, 1, 'first'],
            [2, 2, 'second'],
            [3, 3, 'first'],
        ]);
    });

    /**
     * The same commit touching two separate parts of a file is two edits to a
     * reader, so they must not merge into one block spanning the lines between.
     */
    it('does not join two runs from the same commit across a gap', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two', 'three');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        write('poem.txt', 'EDITED', 'two', 'EDITED');
        repo.git(['commit', '-am', 'second']);

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });

        expect(blame.blocks).toHaveLength(3);
        expect(blame.blocks[0].commit.hash).toBe(blame.blocks[2].commit.hash);
        expect(blame.blocks[1].commit.summary).toBe('first');
    });

    it('reports uncommitted lines as uncommitted', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        write('poem.txt', 'one', 'two', 'not committed yet');

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });
        const last = blame.blocks[blame.blocks.length - 1];

        expect(last.commit.isUncommitted).toBe(true);
        // Git names the current user here, which reads as though it was
        // committed by them.
        expect(last.commit.author).toBe('You');
        expect(last.startLine).toBe(3);
    });

    it('carries the authored date, not the commit date', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one');
        repo.git(['add', 'poem.txt']);
        repo.git([
            '-c',
            'user.name=Test Author',
            'commit',
            '--date',
            '2020-03-04T05:06:07+00:00',
            '-m',
            'dated',
        ]);

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });

        expect(blame.blocks[0].commit.authoredAt.getUTCFullYear()).toBe(2020);
        expect(blame.blocks[0].commit.authoredAt.getUTCMonth()).toBe(2);
    });

    it('handles a commit with an empty message', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '--allow-empty-message', '-m', '']);

        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt' });
        const commit = blame.blocks[0].commit;

        expect(blame.blocks).toHaveLength(1);
        /*
         * Git does not leave `summary` empty or absent — it substitutes the
         * hash in parentheses, the same placeholder `log --oneline` uses. Passed
         * through rather than replaced with wording of our own, so a reader who
         * recognises it from git recognises it here.
         */
        expect(commit.summary).toBe(`(${commit.hash})`);
    });
});

describe('GitCliBlameReader, on an unsaved buffer', () => {
    let repo: TemporaryRepository | undefined;

    const write = (name: string, ...lines: string[]) =>
        writeFileSync(join(repo!.path, name), lines.join('\n') + '\n');

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    /**
     * The reason `--contents` exists here. Blaming the file on disk while the
     * editor holds unsaved changes shifts every line below the edit onto the
     * wrong commit — silently, and in the direction that looks plausible.
     */
    it('keeps lines below an unsaved insertion on their real commit', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        write('poem.txt', 'one', 'CHANGED');
        repo.git(['commit', '-am', 'second']);

        // What the editor holds: a line inserted at the top, not yet saved.
        const buffer = ['INSERTED', 'one', 'CHANGED', ''].join('\n');
        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt', contents: buffer });

        expect(
            blame.blocks.map((b) => [
                b.startLine,
                b.commit.isUncommitted ? 'uncommitted' : b.commit.summary,
            ])
        ).toEqual([
            [1, 'uncommitted'],
            [2, 'first'],
            [3, 'second'],
        ]);
    });

    it('reports a clean buffer exactly as the file on disk', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        const reader = new GitCliBlameReader(repo.path);
        const fromDisk = await reader.read({ path: 'poem.txt' });
        const fromBuffer = await reader.read({ path: 'poem.txt', contents: 'one\ntwo\n' });

        expect(fromBuffer.blocks.map((b) => b.commit.summary)).toEqual(
            fromDisk.blocks.map((b) => b.commit.summary)
        );
    });

    it('survives a buffer large enough for git to stop reading early', async () => {
        // git closes stdin once it has what it needs, and the write that is
        // still in flight then fails with EPIPE. That is normal, not an error.
        repo = TemporaryRepository.create();
        write('poem.txt', 'one');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);

        const big = Array.from({ length: 40_000 }, (_, i) => `line ${i}`).join('\n');
        const blame = await new GitCliBlameReader(repo.path).read({ path: 'poem.txt', contents: `${big}\n` });

        expect(blame.blocks.length).toBeGreaterThan(0);
    });
});

describe('GitCliBlameReader, at a revision', () => {
    let repo: TemporaryRepository | undefined;

    const write = (name: string, ...lines: string[]) =>
        writeFileSync(join(repo!.path, name), lines.join('\n') + '\n');

    afterEach(() => {
        repo?.dispose();
        repo = undefined;
    });

    /**
     * What the historical side of a diff needs. Blaming the working tree there
     * would answer a question about the present while showing the past.
     */
    it('answers as of that revision, not as of now', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one', 'two');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);
        const first = repo.head();

        write('poem.txt', 'one', 'REWRITTEN');
        repo.git(['commit', '-am', 'second']);

        const reader = new GitCliBlameReader(repo.path);
        const atFirst = await reader.read({ path: 'poem.txt', rev: first });
        const now = await reader.read({ path: 'poem.txt' });

        // At the first commit the whole file was its work.
        expect(atFirst.blocks.map((b) => b.commit.summary)).toEqual(['first']);
        expect(now.blocks.map((b) => b.commit.summary)).toEqual([
            'first',
            'second',
        ]);
    });

    it('has nothing to say about a file that did not exist yet', async () => {
        repo = TemporaryRepository.create();
        write('poem.txt', 'one');
        repo.git(['add', 'poem.txt']);
        repo.git(['commit', '-m', 'first']);
        const first = repo.head();

        write('later.txt', 'added afterwards');
        repo.git(['add', 'later.txt']);
        repo.git(['commit', '-m', 'second']);

        // git exits non-zero; the decorator treats that as "no annotations",
        // which is the right answer for a side of a diff showing an addition.
        await expect(
            new GitCliBlameReader(repo.path).read({
                path: 'later.txt',
                rev: first,
            })
        ).rejects.toThrow();
    });
});
