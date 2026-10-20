import { describe, expect, test } from 'vitest';
import { hunkFocusLine, hunkId, type Hunk } from './Hunk';
import {
    addComment,
    commentsInOrder,
    editComment,
    fileState,
    isHunkViewed,
    markFile,
    markHunk,
    markSent,
    unsentComments,
    addReply,
    applyAgentReplies,
    resolve,
    pinSpec,
    reviewProgress,
    sameSpec,
    startReview,
    type Review,
    type ReviewComment,
} from './Review';

const now = new Date('2026-10-20T09:00:00Z');

function review(): Review {
    return startReview({
        id: 'r1',
        root: '/repo',
        label: 'Uncommitted changes',
        spec: { kind: 'workingTree' },
        now,
    });
}

function comment(overrides: Partial<ReviewComment> = {}): ReviewComment {
    return {
        id: 'c1',
        path: 'src/a.ts',
        side: 'new',
        line: 3,
        endLine: 3,
        body: 'Rename this',
        excerpt: 'const x = 1;',
        createdAt: now.toISOString(),
        ...overrides,
    };
}

describe('hunk identity', () => {
    test('survives the hunk moving down the file', () => {
        // The line numbers are not part of the id: an edit above a reviewed
        // hunk must not unread it.
        const lines = ['-old', '+new'];
        expect(hunkId('a.ts', lines)).toBe(hunkId('a.ts', [...lines]));
    });

    test('changes when a word inside it changes', () => {
        expect(hunkId('a.ts', ['-old', '+new'])).not.toBe(
            hunkId('a.ts', ['-old', '+newer'])
        );
    });

    test('is per file, and tells identical twins apart', () => {
        expect(hunkId('a.ts', ['+x'])).not.toBe(hunkId('b.ts', ['+x']));
        expect(hunkId('a.ts', ['+x'], 1)).not.toBe(hunkId('a.ts', ['+x'], 0));
    });

    test('focuses the first changed line, not the context above it', () => {
        const hunk: Hunk = {
            id: 'h',
            oldStart: 10,
            oldLines: 4,
            newStart: 10,
            newLines: 4,
            context: '',
            lines: [' a', ' b', '-c', '+C', ' d'],
        };
        expect(hunkFocusLine(hunk)).toBe(12);
    });
});

describe('viewed marks', () => {
    const file = { path: 'src/a.ts', hunkIds: ['h1', 'h2'] };

    test('a file is viewed exactly when every hunk in it is', () => {
        let state = review();
        expect(fileState(state, file)).toBe('unviewed');

        state = markHunk(state, file.path, 'h1', true);
        expect(fileState(state, file)).toBe('partial');

        state = markHunk(state, file.path, 'h2', true);
        expect(fileState(state, file)).toBe('viewed');
    });

    test('marking the file marks all its hunks, and unmarking clears them', () => {
        let state = markFile(review(), file, true);
        expect(isHunkViewed(state, file.path, 'h1')).toBe(true);
        expect(isHunkViewed(state, file.path, 'h2')).toBe(true);

        state = markFile(state, file, false);
        expect(fileState(state, file)).toBe('unviewed');
        expect(state.viewed).toEqual({});
    });

    test('a rewritten hunk comes back unviewed; the untouched one stays read', () => {
        // What reviewing an agent's second round looks like: one hunk was
        // acted on, so it has a new id; the other was left alone.
        const state = markFile(review(), file, true);
        const afterFix = { path: file.path, hunkIds: ['h1', 'h2-rewritten'] };
        expect(fileState(state, afterFix)).toBe('partial');
    });

    test('does not change the review it was given', () => {
        const original = review();
        markHunk(original, 'a', 'h', true);
        expect(original.viewed).toEqual({});
    });

    test('progress counts a file in two sections once', () => {
        const state = markHunk(review(), 'a.ts', 'staged-hunk', true);
        const progress = reviewProgress(state, [
            { path: 'a.ts', hunkIds: ['staged-hunk'] },
            { path: 'a.ts', hunkIds: ['unstaged-hunk'] },
            { path: 'b.ts', hunkIds: ['b1'] },
        ]);
        expect(progress).toEqual({
            files: 2,
            filesViewed: 0,
            hunks: 3,
            hunksViewed: 1,
        });
    });
});

describe('pinning', () => {
    test('a branch comparison is frozen to the revisions it resolved', () => {
        expect(
            pinSpec(
                { kind: 'twoRefs', left: 'main', right: 'feature' },
                { baseRev: 'aaa', targetRev: 'bbb' }
            )
        ).toEqual({ kind: 'twoRefs', left: 'aaa', right: 'bbb' });
    });

    test('work against the working tree keeps the disk as its newer side', () => {
        expect(
            pinSpec(
                { kind: 'branchAgainstBase', base: 'main', includeWorkingTree: true },
                { baseRev: 'merge-base' }
            )
        ).toEqual({
            kind: 'twoRefs',
            left: 'merge-base',
            right: 'WORKTREE',
            rightIsWorkingTree: true,
        });
    });

    test('the working tree itself stays live', () => {
        expect(pinSpec({ kind: 'workingTree' }, { baseRev: 'HEAD' })).toEqual({
            kind: 'workingTree',
        });
    });

    test('a selection is the same selection whatever order it was clicked in', () => {
        expect(
            sameSpec(
                { kind: 'commitSet', hashes: ['b', 'a'] },
                { kind: 'commitSet', hashes: ['a', 'b'] }
            )
        ).toBe(true);
        expect(
            sameSpec({ kind: 'singleCommit', hash: 'a' }, { kind: 'singleCommit', hash: 'b' })
        ).toBe(false);
    });
});

describe('comments', () => {
    test('refuses an empty one', () => {
        expect(() => addComment(review(), comment({ body: '  ' }))).toThrow();
    });

    test('refuses one that ends before it starts', () => {
        expect(() => addComment(review(), comment({ line: 5, endLine: 4 }))).toThrow();
    });

    test('emptying a comment deletes it', () => {
        const state = editComment(addComment(review(), comment()), 'c1', '');
        expect(state.comments).toEqual([]);
    });

    test('once handed over, are not handed over again', () => {
        let state = addComment(review(), comment({ id: 'a' }));
        state = markSent(state, ['a'], now, 'Claude Code — review');
        expect(state.comments[0].sentTo).toBe('Claude Code — review');
        state = addComment(state, comment({ id: 'b' }));
        expect(unsentComments(state).map((c) => c.id)).toEqual(['b']);
    });

    test('an agent reply lands in its thread once, however often the file is read', () => {
        const state = addComment(review(), comment({ id: 'a' }));
        const replies = [{ comment: 'a', reply: 'Renamed it.', status: 'done' as const }];
        const idFor = (r: { comment: string; reply: string }) => `${r.comment}:${r.reply}`;
        const once = applyAgentReplies(state, replies, { author: 'Claude Code', now, idFor });
        const twice = applyAgentReplies(once.review, replies, { author: 'Claude Code', now, idFor });

        expect(once.answered).toEqual(['a']);
        expect(twice.answered).toEqual([]);
        expect(twice.review.comments[0].replies).toHaveLength(1);
        expect(twice.review.comments[0].replies?.[0]).toMatchObject({
            from: 'agent',
            author: 'Claude Code',
            status: 'done',
        });
    });

    test('a reply to a comment the review does not have is ignored', () => {
        const state = addComment(review(), comment({ id: 'a' }));
        const result = applyAgentReplies(state, [{ comment: 'nope', reply: 'x' }], {
            now,
            idFor: () => 'id',
        });
        expect(result.answered).toEqual([]);
    });

    test('your answer in a sent thread sends the thread again; resolving keeps it out', () => {
        let state = addComment(review(), comment({ id: 'a' }));
        state = markSent(state, ['a'], now);
        expect(unsentComments(state)).toEqual([]);

        state = addReply(state, 'a', { id: 'r1', body: 'Also the tests, please.', now });
        expect(unsentComments(state).map((c) => c.id)).toEqual(['a']);

        state = markSent(state, ['a'], now);
        expect(unsentComments(state)).toEqual([]);
        expect(state.comments[0].replies?.[0].sentAt).toBeDefined();

        state = addReply(state, 'a', { id: 'r2', body: 'One more thing.', now });
        state = resolve(state, 'a', true, now);
        expect(unsentComments(state)).toEqual([]);
    });

    test('answering a resolved thread reopens it', () => {
        let state = resolve(addComment(review(), comment({ id: 'a' })), 'a', true, now);
        state = addReply(state, 'a', { id: 'r', body: 'Not quite.', now });
        expect(state.comments[0].resolvedAt).toBeUndefined();
    });

    test('are read back by file, then by line', () => {
        let state = review();
        state = addComment(state, comment({ id: '3', path: 'b.ts', line: 1, endLine: 1 }));
        state = addComment(state, comment({ id: '2', path: 'a.ts', line: 9, endLine: 9 }));
        state = addComment(state, comment({ id: '1', path: 'a.ts', line: 2, endLine: 2 }));
        expect(commentsInOrder(state).map((c) => c.id)).toEqual(['1', '2', '3']);
    });
});
