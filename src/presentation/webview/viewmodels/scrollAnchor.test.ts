import { describe, expect, it } from 'vitest';
import { anchorAt, scrollTopFor } from './scrollAnchor';

const ROW = 40;
const rows = ['a', 'b', 'c', 'd', 'e'];

describe('anchorAt', () => {
    it('names the row at the top of the viewport', () => {
        expect(anchorAt(80, ROW, rows)).toEqual({ hash: 'c', offset: 0 });
    });

    it('keeps how far into that row the viewport starts', () => {
        expect(anchorAt(95, ROW, rows)).toEqual({ hash: 'c', offset: 15 });
    });

    it('has nothing to restore at the top of the list', () => {
        expect(anchorAt(0, ROW, rows)).toBeNull();
    });

    it('has nothing to restore past the end of the list', () => {
        expect(anchorAt(10_000, ROW, rows)).toBeNull();
    });
});

describe('scrollTopFor', () => {
    it('puts the anchored row back where it was', () => {
        const anchor = anchorAt(95, ROW, rows)!;
        expect(scrollTopFor(anchor, ROW, rows)).toBe(95);
    });

    it('absorbs commits inserted above it', () => {
        // What a new commit does: the graph is newest-first, so 'c' is now two
        // rows further down and must move down with the content.
        const anchor = anchorAt(95, ROW, rows)!;
        expect(scrollTopFor(anchor, ROW, ['new', 'newer', ...rows])).toBe(175);
    });

    it('absorbs commits removed above it', () => {
        const anchor = anchorAt(95, ROW, rows)!;
        expect(scrollTopFor(anchor, ROW, ['b', 'c', 'd', 'e'])).toBe(55);
    });

    it('gives up when the anchored commit is gone', () => {
        // An amend or a rebase: the hash the reader was looking at no longer
        // exists, and no pixel in the new graph is the same place.
        const anchor = anchorAt(95, ROW, rows)!;
        expect(scrollTopFor(anchor, ROW, ['a', 'b', 'd', 'e'])).toBeNull();
    });
});
