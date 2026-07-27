import { describe, expect, test } from 'vitest';
import { GitLogParser } from './GitLogParser';
import { RECORD_SEPARATOR, UNIT_SEPARATOR } from './gitCommands';

const record = (...fields: string[]) =>
    fields.join(UNIT_SEPARATOR) + RECORD_SEPARATOR;

const refLine = (refName: string, objectName: string, head = '') =>
    [refName, objectName, head].join(UNIT_SEPARATOR);

describe('GitLogParser.parseCommits', () => {
    test('parses a record into a commit', () => {
        const [commit] = GitLogParser.parseCommits(
            record(
                'abc123',
                'def456 789abc',
                'Ada Lovelace',
                '2023-05-01T12:00:00+02:00',
                'HEAD -> main, origin/main, tag: v1.0',
                'Merge the thing'
            )
        );

        expect(commit.hash).toBe('abc123');
        expect(commit.parentHashes).toEqual(['def456', '789abc']);
        expect(commit.author).toBe('Ada Lovelace');
        expect(commit.message).toBe('Merge the thing');
        expect(commit.isMergeCommit).toBe(true);
        expect(commit.timestamp.toISOString()).toBe('2023-05-01T10:00:00.000Z');
        expect(commit.refs).toEqual(['main', 'origin/main', 'v1.0']);
    });

    test('treats a root commit as having no parents', () => {
        const [commit] = GitLogParser.parseCommits(
            record('abc123', '', 'A', '2023-05-01T12:00:00Z', '', 'first')
        );

        expect(commit.parentHashes).toEqual([]);
        expect(commit.isRootCommit).toBe(true);
    });

    test('keeps a detached HEAD decoration as-is', () => {
        const [commit] = GitLogParser.parseCommits(
            record('abc123', '', 'A', '2023-05-01T12:00:00Z', 'HEAD', 'first')
        );

        expect(commit.refs).toEqual(['HEAD']);
    });

    test('accepts an empty subject', () => {
        const [commit] = GitLogParser.parseCommits(
            record('abc123', 'def456', 'A', '2023-05-01T12:00:00Z', '', '')
        );

        expect(commit.message).toBe('');
    });

    test('falls back when the author is missing and the date is unparseable', () => {
        const [commit] = GitLogParser.parseCommits(
            record('abc123', '', '', 'not-a-date', '', 'subject')
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
            record('abc123', '', 'A', '2023-05-01T12:00:00Z', '', 'good') +
                'partial' +
                UNIT_SEPARATOR +
                'record'
        );

        expect(commits).toHaveLength(1);
        expect(commits[0].message).toBe('good');
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
