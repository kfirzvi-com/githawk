import { describe, expect, test } from 'vitest';
import { GitLogParser } from './GitLogParser';
import { RECORD_SEPARATOR, UNIT_SEPARATOR } from './gitCommands';

/**
 * Builds one log record in the shipping field order. Named rather than
 * positional, because nine positional strings is unreadable and the order has
 * already changed once.
 */
const record = (fields: {
    hash?: string;
    parents?: string;
    author?: string;
    authorEmail?: string;
    authorDate?: string;
    committer?: string;
    committerDate?: string;
    decorations?: string;
    message?: string;
}) =>
    [
        fields.hash ?? 'abc123',
        fields.parents ?? '',
        fields.author ?? 'Test Author',
        fields.authorEmail ?? 'test@example.com',
        fields.authorDate ?? '2023-05-01T12:00:00Z',
        fields.committer ?? fields.author ?? 'Test Author',
        fields.committerDate ?? fields.authorDate ?? '2023-05-01T12:00:00Z',
        fields.decorations ?? '',
        fields.message ?? 'subject',
    ].join(UNIT_SEPARATOR) + RECORD_SEPARATOR;

const refLine = (refName: string, objectName: string, head = '') =>
    [refName, objectName, head].join(UNIT_SEPARATOR);

describe('GitLogParser.parseCommits', () => {
    test('parses a record into a commit', () => {
        const [commit] = GitLogParser.parseCommits(
            record({
                hash: 'abc123',
                parents: 'def456 789abc',
                author: 'Ada Lovelace',
                authorEmail: 'ada@example.com',
                authorDate: '2023-05-01T12:00:00+02:00',
                // --decorate=full emits full ref paths.
                decorations:
                    'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0',
                message: 'Merge the thing',
            })
        );

        expect(commit.hash).toBe('abc123');
        expect(commit.parentHashes).toEqual(['def456', '789abc']);
        expect(commit.author).toBe('Ada Lovelace');
        expect(commit.authorEmail).toBe('ada@example.com');
        expect(commit.message).toBe('Merge the thing');
        expect(commit.isMergeCommit).toBe(true);
        expect(commit.timestamp.toISOString()).toBe('2023-05-01T10:00:00.000Z');
        expect(commit.refs).toEqual([
            { kind: 'localBranch', name: 'main', isHead: true },
            { kind: 'remoteBranch', name: 'origin/main', isHead: false },
            { kind: 'tag', name: 'v1.0', isHead: false },
        ]);
        expect(commit.branchNames).toEqual(['main', 'origin/main']);
        expect(commit.tagNames).toEqual(['v1.0']);
        expect(commit.isHead).toBe(true);
    });

    test('drops refs it should not decorate with', () => {
        const [commit] = GitLogParser.parseCommits(
            record({
                decorations:
                    'refs/stash, refs/notes/commits, refs/remotes/origin/HEAD, refs/heads/main',
            })
        );

        // origin/HEAD only aliases a branch already decorated here.
        expect(commit.refs).toEqual([
            { kind: 'localBranch', name: 'main', isHead: false },
        ]);
    });

    test('distinguishes a tag from a branch with the same name', () => {
        const [commit] = GitLogParser.parseCommits(
            record({
                decorations: 'refs/heads/release, tag: refs/tags/release',
            })
        );

        expect(commit.branchNames).toEqual(['release']);
        expect(commit.tagNames).toEqual(['release']);
        expect(commit.hasBranch('release')).toBe(true);
    });

    test('treats a root commit as having no parents', () => {
        const [commit] = GitLogParser.parseCommits(
            record({ message: 'first' })
        );

        expect(commit.parentHashes).toEqual([]);
        expect(commit.isRootCommit).toBe(true);
    });

    test('records a detached HEAD as its own kind', () => {
        const [commit] = GitLogParser.parseCommits(
            record({ decorations: 'HEAD', message: 'first' })
        );

        expect(commit.refs).toEqual([
            { kind: 'head', name: 'HEAD', isHead: true },
        ]);
        // Detached HEAD is not a branch, so it must not be mistaken for one.
        expect(commit.branchNames).toEqual([]);
        expect(commit.isHead).toBe(true);
    });

    test('accepts an empty subject', () => {
        const [commit] = GitLogParser.parseCommits(
            record({ parents: 'def456', message: '' })
        );

        expect(commit.message).toBe('');
    });

    test('falls back when the author is missing and the date is unparseable', () => {
        const [commit] = GitLogParser.parseCommits(
            record({ author: '', authorDate: 'not-a-date', committerDate: 'not-a-date' })
        );

        expect(commit.author).toBe('Unknown');
        expect(commit.timestamp.getTime()).toBe(0);
    });

    test('returns nothing for empty output', () => {
        expect(GitLogParser.parseCommits('')).toEqual([]);
        expect(GitLogParser.parseCommits('\n')).toEqual([]);
    });

    test('skips truncated records rather than throwing', () => {
        const commits = GitLogParser.parseCommits(
            record({ message: 'good' }) + 'partial' + UNIT_SEPARATOR + 'record'
        );

        expect(commits).toHaveLength(1);
        expect(commits[0].message).toBe('good');
    });
});

describe('GitLogParser multi-line messages', () => {
    test('keeps a body containing newlines and blank lines', () => {
        const [commit] = GitLogParser.parseCommits(
            record({
                message: 'Subject line\n\nA paragraph.\n\n  - a bullet\n\nRefs: #9',
            })
        );

        // %B is last in the format precisely so newlines cannot be mistaken for
        // the next field.
        expect(commit.subject).toBe('Subject line');
        expect(commit.body).toContain('A paragraph.');
        expect(commit.body).toContain('- a bullet');
        expect(commit.body).toContain('Refs: #9');
    });

    test('parses two records even when the first has a multi-line message', () => {
        const commits = GitLogParser.parseCommits(
            record({ hash: 'aaa', message: 'First\n\nwith a body' }) +
                record({ hash: 'bbb', message: 'Second' })
        );

        expect(commits.map((c) => c.hash)).toEqual(['aaa', 'bbb']);
        expect(commits[0].hasBody).toBe(true);
        expect(commits[1].hasBody).toBe(false);
    });

    test('records the committer when it differs from the author', () => {
        const [commit] = GitLogParser.parseCommits(
            record({
                author: 'Ada',
                committer: 'Grace',
                authorDate: '2023-01-01T00:00:00Z',
                committerDate: '2023-06-01T00:00:00Z',
            })
        );

        expect(commit.committer).toBe('Grace');
        expect(commit.wasRewritten).toBe(true);
    });

    test('does not flag a rewrite when author and committer agree', () => {
        const [commit] = GitLogParser.parseCommits(
            record({ author: 'Ada', committer: 'Ada' })
        );

        expect(commit.wasRewritten).toBe(false);
    });
});

describe('GitLogParser.parseBranches', () => {
    test('classifies local and remote branches', () => {
        const branches = GitLogParser.parseBranches(
            [
                refLine('refs/heads/main', 'aaa', '*'),
                refLine('refs/heads/feature/thing', 'bbb'),
                refLine('refs/remotes/origin/main', 'ccc'),
            ].join('\n')
        );

        expect(branches).toHaveLength(3);

        const [main, feature, remote] = branches;
        expect(main.name).toBe('main');
        expect(main.isLocal).toBe(true);
        expect(main.isCurrent).toBe(true);

        expect(feature.name).toBe('feature/thing');
        expect(feature.isCurrent).toBe(false);

        expect(remote.name).toBe('origin/main');
        expect(remote.isRemote).toBe(true);
    });

    test('drops refs/remotes/origin/HEAD, which only aliases another branch', () => {
        const branches = GitLogParser.parseBranches(
            [
                refLine('refs/remotes/origin/HEAD', 'aaa'),
                refLine('refs/remotes/origin/main', 'aaa'),
            ].join('\n')
        );

        expect(branches.map((b) => b.name)).toEqual(['origin/main']);
    });

    test('ignores tags and other non-branch refs', () => {
        const branches = GitLogParser.parseBranches(
            [
                refLine('refs/tags/v1.0', 'aaa'),
                refLine('refs/stash', 'bbb'),
                refLine('refs/heads/main', 'ccc', '*'),
            ].join('\n')
        );

        expect(branches.map((b) => b.name)).toEqual(['main']);
    });

    test('returns nothing for empty output', () => {
        expect(GitLogParser.parseBranches('')).toEqual([]);
    });
});
