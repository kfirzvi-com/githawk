import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GitCliComparer } from './GitCliComparer';
import { TemporaryRepository } from './testing/temporaryRepository';
import { CompareUseCase } from '../../application/usecases/CompareUseCase';

const repos: TemporaryRepository[] = [];

function newRepo(defaultBranch = 'main'): TemporaryRepository {
    const repo = TemporaryRepository.create(defaultBranch);
    repos.push(repo);
    return repo;
}

afterEach(() => {
    while (repos.length) {
        repos.pop()!.dispose();
    }
});

/** Writes a tracked file with specific contents and commits it. */
function commitFile(
    repo: TemporaryRepository,
    path: string,
    contents: string,
    message: string
): string {
    writeFileSync(join(repo.path, path), contents);
    repo.git(['add', path]);
    repo.git(['commit', '-m', message]);
    return repo.head();
}

const pathsOf = (files: { path: string }[]) => files.map((f) => f.path).sort();

describe('branch against base', () => {
    test('shows the whole feature as one changeset', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        commitFile(repo, 'a.txt', 'one\n', 'add a');
        commitFile(repo, 'b.txt', 'two\n', 'add b');
        commitFile(repo, 'a.txt', 'one\ntwo\n', 'extend a');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        expect(comparison.method).toBe('mergeBase');
        // Three commits, but a.txt appears once with its cumulative change.
        expect(pathsOf(comparison.files)).toEqual(['a.txt', 'b.txt']);
        const a = comparison.files.find((f) => f.path === 'a.txt')!;
        expect(a.status).toBe('added');
        expect(a.insertions).toBe(2);
    });

    test('excludes work that landed on the base after branching', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        commitFile(repo, 'mine.txt', 'mine\n', 'my work');

        // Someone else pushes to main while the feature is in progress.
        repo.checkout('main');
        commitFile(repo, 'theirs.txt', 'theirs\n', 'their work');
        repo.checkout('feature');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        // A two-dot `main..HEAD` diff would show theirs.txt as a deletion. The
        // merge base is what keeps someone else's work out of your review.
        expect(pathsOf(comparison.files)).toEqual(['mine.txt']);
    });

    test('includes uncommitted work when asked', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        commitFile(repo, 'committed.txt', 'done\n', 'committed work');

        // In-progress, not yet committed.
        writeFileSync(join(repo.path, 'wip.txt'), 'in progress\n');
        repo.git(['add', 'wip.txt']);

        const comparer = new GitCliComparer(repo.path);

        const committedOnly = await comparer.compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });
        expect(pathsOf(committedOnly.files)).toEqual(['committed.txt']);

        const withWorkingTree = await comparer.compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: true,
        });
        expect(pathsOf(withWorkingTree.files)).toEqual([
            'committed.txt',
            'wip.txt',
        ]);
        expect(withWorkingTree.targetRev).toBeUndefined();
    });

    test('reports deletions and modifications with line counts', async () => {
        const repo = newRepo();
        commitFile(repo, 'keep.txt', 'a\nb\nc\n', 'base');
        commitFile(repo, 'doomed.txt', 'gone\n', 'add doomed');
        repo.branch('feature');
        repo.git(['rm', 'doomed.txt']);
        repo.git(['commit', '-m', 'remove doomed']);
        commitFile(repo, 'keep.txt', 'a\nb\nc\nd\n', 'extend keep');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        const doomed = comparison.files.find((f) => f.path === 'doomed.txt')!;
        expect(doomed.status).toBe('deleted');
        expect(doomed.deletions).toBe(1);

        const keep = comparison.files.find((f) => f.path === 'keep.txt')!;
        expect(keep.status).toBe('modified');
        expect(keep.insertions).toBe(1);
        expect(keep.deletions).toBe(0);
    });

    test('detects a rename and reports its previous path', async () => {
        const repo = newRepo();
        commitFile(repo, 'old-name.txt', 'stable contents\nsecond line\n', 'base');
        repo.branch('feature');
        repo.git(['mv', 'old-name.txt', 'new-name.txt']);
        repo.git(['commit', '-m', 'rename']);

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        const renamed = comparison.files[0];
        expect(renamed.status).toBe('renamed');
        expect(renamed.path).toBe('new-name.txt');
        expect(renamed.previousPath).toBe('old-name.txt');
    });

    test('handles paths containing spaces and quotes', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        const awkward = 'a file with "quotes" and spaces.txt';
        commitFile(repo, awkward, 'contents\n', 'add awkward path');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        // -z output is why this works; quoted paths would arrive escaped.
        expect(comparison.files.map((f) => f.path)).toEqual([awkward]);
    });

    test('reports binary files without inventing line counts', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        writeFileSync(
            join(repo.path, 'blob.bin'),
            Buffer.from([0, 1, 2, 3, 0, 255, 254])
        );
        repo.git(['add', 'blob.bin']);
        repo.git(['commit', '-m', 'add binary']);

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        const binary = comparison.files.find((f) => f.path === 'blob.bin')!;
        expect(binary.isBinary).toBe(true);
        expect(binary.insertions).toBe(0);
        expect(binary.deletions).toBe(0);
    });
});

describe('single commit and ranges', () => {
    test('shows only what one commit changed', async () => {
        const repo = newRepo();
        commitFile(repo, 'a.txt', 'a\n', 'first');
        const second = commitFile(repo, 'b.txt', 'b\n', 'second');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'singleCommit',
            hash: second,
        });

        expect(pathsOf(comparison.files)).toEqual(['b.txt']);
        expect(comparison.method).toBe('singleCommit');
    });

    test('treats a root commit as all additions rather than failing', async () => {
        const repo = newRepo();
        const root = commitFile(repo, 'a.txt', 'a\n', 'first');

        // `root^` does not resolve; the empty tree stands in.
        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'singleCommit',
            hash: root,
        });

        expect(pathsOf(comparison.files)).toEqual(['a.txt']);
        expect(comparison.files[0].status).toBe('added');
    });

    test('collapses a contiguous range into one changeset', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const first = commitFile(repo, 'a.txt', 'one\n', 'add a');
        commitFile(repo, 'a.txt', 'one\ntwo\n', 'extend a');
        const last = commitFile(repo, 'b.txt', 'b\n', 'add b');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'commitRange',
            oldest: first,
            newest: last,
        });

        expect(comparison.method).toBe('range');
        expect(pathsOf(comparison.files)).toEqual(['a.txt', 'b.txt']);
        expect(
            comparison.files.find((f) => f.path === 'a.txt')!.insertions
        ).toBe(2);
    });
});

describe('arbitrary commit selections', () => {
    test('aggregates two non-adjacent commits without the one between them', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const first = commitFile(repo, 'first.txt', 'first\n', 'add first');
        commitFile(repo, 'skipped.txt', 'skipped\n', 'add skipped');
        const third = commitFile(repo, 'third.txt', 'third\n', 'add third');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'commitSet',
            hashes: [third, first],
        });

        expect(comparison.method).toBe('replay');
        // The commit in between is genuinely absent from the aggregate.
        expect(pathsOf(comparison.files)).toEqual(['first.txt', 'third.txt']);
    });

    test('leaves the real repository untouched', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const first = commitFile(repo, 'a.txt', 'a\n', 'add a');
        const second = commitFile(repo, 'b.txt', 'b\n', 'add b');

        // Uncommitted work that must survive the replay.
        writeFileSync(join(repo.path, 'wip.txt'), 'precious\n');

        const headBefore = repo.head();
        const branchBefore = repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();

        await new GitCliComparer(repo.path).compare({
            kind: 'commitSet',
            hashes: [second, first],
        });

        expect(repo.head()).toBe(headBefore);
        expect(repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()).toBe(
            branchBefore
        );
        expect(repo.git(['status', '--porcelain'])).toContain('wip.txt');
    });

    test('records commits that could not be combined instead of failing', async () => {
        const repo = newRepo();
        commitFile(repo, 'shared.txt', 'original\n', 'base');
        const a = commitFile(repo, 'shared.txt', 'version A\n', 'change to A');
        commitFile(repo, 'shared.txt', 'version B\n', 'change to B');
        const c = commitFile(repo, 'shared.txt', 'version C\n', 'change to C');

        // A and C both rewrite the same single line from different starting
        // points, so replaying both cannot succeed cleanly.
        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'commitSet',
            hashes: [c, a],
        });

        expect(comparison.method).toBe('replay');
        expect(comparison.skipped?.length ?? 0).toBeGreaterThan(0);
        expect(comparison.skipped![0].reason).toBeTruthy();
    });

    test('a single-commit selection matches that commit exactly', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const only = commitFile(repo, 'a.txt', 'a\n', 'add a');

        const viaSet = await new GitCliComparer(repo.path).compare({
            kind: 'commitSet',
            hashes: [only],
        });
        const direct = await new GitCliComparer(repo.path).compare({
            kind: 'singleCommit',
            hash: only,
        });

        expect(pathsOf(viaSet.files)).toEqual(pathsOf(direct.files));
    });

    test('leaves no worktrees behind', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const a = commitFile(repo, 'a.txt', 'a\n', 'add a');

        await new GitCliComparer(repo.path).compare({
            kind: 'commitSet',
            hashes: [a],
        });

        const worktrees = repo.git(['worktree', 'list']);
        // Only the main worktree remains.
        expect(worktrees.trim().split('\n')).toHaveLength(1);
    });

    test('the replayed result stays readable after cleanup', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        const a = commitFile(repo, 'a.txt', 'contents\n', 'add a');

        const comparer = new GitCliComparer(repo.path);
        const comparison = await comparer.compare({
            kind: 'commitSet',
            hashes: [a],
        });

        // The worktree is gone, but its commit lives in the shared object
        // database — which is what lets the diff editor open the file.
        const contents = await comparer.fileContentAt(
            comparison.targetRev!,
            'a.txt'
        );
        expect(contents).toContain('contents');
    });
});

describe('fileContentAt', () => {
    test('returns contents at a revision', async () => {
        const repo = newRepo();
        const first = commitFile(repo, 'a.txt', 'first version\n', 'first');
        commitFile(repo, 'a.txt', 'second version\n', 'second');

        const comparer = new GitCliComparer(repo.path);

        expect(await comparer.fileContentAt(first, 'a.txt')).toContain(
            'first version'
        );
        expect(await comparer.fileContentAt('HEAD', 'a.txt')).toContain(
            'second version'
        );
    });

    test('returns empty for a file that did not exist yet', async () => {
        const repo = newRepo();
        const first = commitFile(repo, 'a.txt', 'a\n', 'first');
        commitFile(repo, 'b.txt', 'b\n', 'second');

        // An added file has no left-hand side, and empty is the correct diff.
        expect(
            await new GitCliComparer(repo.path).fileContentAt(first, 'b.txt')
        ).toBe('');
    });
});

describe('CompareUseCase', () => {
    test('reports totals and explains how the comparison was made', async () => {
        const repo = newRepo();
        commitFile(repo, 'base.txt', 'base\n', 'base');
        repo.branch('feature');
        commitFile(repo, 'a.txt', 'one\ntwo\n', 'add a');

        const dto = await new CompareUseCase(
            new GitCliComparer(repo.path)
        ).execute({
            kind: 'branchAgainstBase',
            base: 'main',
            includeWorkingTree: false,
        });

        expect(dto.totals.files).toBe(1);
        expect(dto.totals.insertions).toBe(2);
        expect(dto.methodExplanation).toMatch(/diverged/i);
        expect(dto.skipped).toEqual([]);
    });
});

describe('the working tree, in groups', () => {
    const groupsOf = (comparison: Awaited<ReturnType<GitCliComparer['compare']>>) =>
        Object.fromEntries(
            (comparison.groups ?? []).map((group) => [
                group.kind,
                pathsOf(group.files),
            ])
        );

    test('a clean tree has no groups at all', async () => {
        const repo = newRepo();
        commitFile(repo, 'a.txt', 'a\n', 'a');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(comparison.method).toBe('workingTree');
        expect(comparison.groups).toEqual([]);
        expect(comparison.files).toEqual([]);
    });

    test('sorts each file into the section git puts it in', async () => {
        const repo = newRepo();
        commitFile(repo, 'staged.txt', 'before\n', 'add staged');
        commitFile(repo, 'edited.txt', 'before\n', 'add edited');

        writeFileSync(join(repo.path, 'staged.txt'), 'after\n');
        repo.git(['add', 'staged.txt']);
        writeFileSync(join(repo.path, 'edited.txt'), 'after\n');
        mkdirSync(join(repo.path, 'new'));
        writeFileSync(join(repo.path, 'new', 'file.txt'), 'brand new\n');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(groupsOf(comparison)).toEqual({
            staged: ['staged.txt'],
            unstaged: ['edited.txt'],
            untracked: ['new/file.txt'],
        });
        // Untracked files are in the changeset now, which the row used to
        // apologise for not managing.
        expect(pathsOf(comparison.files)).toEqual([
            'edited.txt',
            'new/file.txt',
            'staged.txt',
        ]);
        const untracked = comparison.groups!.find((g) => g.kind === 'untracked')!;
        expect(untracked.files[0].status).toBe('untracked');
    });

    /**
     * Each section opens the diff it means. These are the revisions the diff
     * editor is handed, so they are pinned here: `:0` is git's own name for
     * the index, and `undefined` on the right is the file on disk.
     */
    test('gives each section the two revisions its diff compares', async () => {
        const repo = newRepo();
        commitFile(repo, 'a.txt', 'one\n', 'a');
        writeFileSync(join(repo.path, 'a.txt'), 'two\n');
        repo.git(['add', 'a.txt']);
        writeFileSync(join(repo.path, 'a.txt'), 'three\n');
        writeFileSync(join(repo.path, 'b.txt'), 'new\n');

        const comparer = new GitCliComparer(repo.path);
        const comparison = await comparer.compare({ kind: 'workingTree' });
        const byKind = Object.fromEntries(
            comparison.groups!.map((group) => [group.kind, group])
        );

        expect([byKind.staged.baseRev, byKind.staged.targetRev]).toEqual([
            'HEAD',
            ':0',
        ]);
        expect([byKind.unstaged.baseRev, byKind.unstaged.targetRev]).toEqual([
            ':0',
            undefined,
        ]);
        expect([byKind.untracked.baseRev, byKind.untracked.targetRev]).toEqual([
            'HEAD',
            undefined,
        ]);

        // And those revisions read what they claim to: the staged content
        // is "two", not what is on disk.
        expect(await comparer.fileContentAt(':0', 'a.txt')).toBe('two\n');
        expect(await comparer.fileContentAt('HEAD', 'a.txt')).toBe('one\n');
        // An untracked file has no HEAD side, which reads as empty.
        expect(await comparer.fileContentAt('HEAD', 'b.txt')).toBe('');
    });

    test('a file staged and then edited again is in both sections', async () => {
        const repo = newRepo();
        commitFile(repo, 'a.txt', 'one\n', 'a');
        writeFileSync(join(repo.path, 'a.txt'), 'two\n');
        repo.git(['add', 'a.txt']);
        writeFileSync(join(repo.path, 'a.txt'), 'three\n');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(groupsOf(comparison)).toEqual({
            staged: ['a.txt'],
            unstaged: ['a.txt'],
        });
    });

    test('honours .gitignore when listing untracked files', async () => {
        const repo = newRepo();
        commitFile(repo, '.gitignore', 'build/\n', 'ignore build');
        mkdirSync(join(repo.path, 'build'));
        writeFileSync(join(repo.path, 'build', 'out.js'), 'x');
        writeFileSync(join(repo.path, 'kept.txt'), 'x');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(groupsOf(comparison)).toEqual({ untracked: ['kept.txt'] });
    });

    test('puts a conflicted file in its own section, first', async () => {
        const repo = newRepo();
        commitFile(repo, 'c.txt', 'base\n', 'base');
        repo.branch('theirs');
        commitFile(repo, 'c.txt', 'theirs\n', 'theirs');
        repo.checkout('main');
        commitFile(repo, 'c.txt', 'ours\n', 'ours');
        writeFileSync(join(repo.path, 'other.txt'), 'untracked\n');
        try {
            repo.git(['merge', 'theirs']);
        } catch {
            // The conflict is the point.
        }

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(comparison.groups!.map((g) => g.kind)).toEqual([
            'conflicted',
            'untracked',
        ]);
        expect(comparison.groups![0].files[0].status).toBe('conflicted');
    });

    test('works on a repository with no commits yet', async () => {
        const repo = newRepo();
        writeFileSync(join(repo.path, 'first.txt'), 'hello\n');
        repo.git(['add', 'first.txt']);
        writeFileSync(join(repo.path, 'loose.txt'), 'hello\n');

        const comparison = await new GitCliComparer(repo.path).compare({
            kind: 'workingTree',
        });

        expect(groupsOf(comparison)).toEqual({
            staged: ['first.txt'],
            untracked: ['loose.txt'],
        });
    });
});
