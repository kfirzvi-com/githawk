import { describe, expect, test } from 'vitest';
import { addComment, startReview } from '../../domain/models/Review';
import { commandWithPrompt, reviewDocument, reviewPrompt } from './reviewHandoff';

const base = startReview({
    id: 'r1',
    root: '/repo',
    label: 'Uncommitted changes',
    spec: { kind: 'workingTree' },
    now: new Date('2026-10-20T09:00:00Z'),
});

describe('the review document', () => {
    const review = [
        { id: '2', path: 'src/b.ts', line: 4, endLine: 6, body: 'Extract this', excerpt: 'a\nb\nc' },
        { id: '1', path: 'src/a.ts', line: 10, endLine: 10, body: 'Typo', excerpt: 'cosnt x' },
    ].reduce(
        (state, comment) =>
            addComment(state, {
                ...comment,
                side: 'new',
                createdAt: '2026-10-20T09:00:00Z',
            }),
        base
    );

    test('lists every comment in reading order, with the lines it was written on', () => {
        const document = reviewDocument(review);
        expect(document).toContain('2 comments');
        expect(document.indexOf('`src/a.ts`, line 10')).toBeLessThan(
            document.indexOf('`src/b.ts`, lines 4–6')
        );
        expect(document).toContain('```\ncosnt x\n```');
    });

    test('a review of commits says the fixes go in the working tree', () => {
        const committed = addComment(
            { ...base, spec: { kind: 'singleCommit', hash: 'abcdef1234567890' } },
            { id: '9', path: 'a.ts', side: 'new', line: 1, endLine: 1, body: 'x', excerpt: 'y', createdAt: '' }
        );
        expect(reviewDocument(committed)).toContain('commit abcdef123456');
        expect(reviewDocument(committed)).toMatch(/working tree as it is now/);
        expect(reviewDocument(review)).not.toMatch(/committed history/);
    });

    test('a quoted excerpt that has its own fence cannot close the quote', () => {
        const fenced = addComment(base, {
            id: '3',
            path: 'README.md',
            side: 'new',
            line: 1,
            endLine: 1,
            body: 'Shorter',
            excerpt: '```js',
            createdAt: '',
        });
        expect(reviewDocument(fenced)).toContain('~~~~\n```js\n~~~~');
    });
});

describe('the handoff', () => {
    test('the prompt is a single line', () => {
        expect(reviewPrompt('/repo/.git/githawk/review.md', 3)).not.toContain('\n');
    });

    test('the prompt is quoted so a path cannot break out of it', () => {
        expect(commandWithPrompt('claude {prompt}', "it's here; rm -rf ~")).toBe(
            `claude 'it'\\''s here; rm -rf ~'`
        );
    });

    test('a template without a placeholder gets the prompt appended', () => {
        expect(commandWithPrompt('codex', 'go')).toBe(`codex 'go'`);
    });
});
