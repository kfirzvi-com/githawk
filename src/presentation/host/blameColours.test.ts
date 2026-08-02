import { describe, expect, it } from 'vitest';
import type { BlameBlock } from '../../domain/models/Blame';
import { commitRanks, rampColour } from './blameColours';

const block = (
    hash: string,
    at: string,
    line = 1,
    isUncommitted = false
): BlameBlock => ({
    startLine: line,
    endLine: line,
    commit: {
        hash: hash.repeat(40).slice(0, 40),
        shortHash: hash.repeat(8).slice(0, 8),
        author: 'A',
        authorEmail: 'a@example.com',
        authoredAt: new Date(at),
        summary: 's',
        isUncommitted,
    },
});

const alphaOf = (colour: string) =>
    Number(/rgba\([^)]*,\s*([0-9.]+)\)$/.exec(colour)![1]);

describe('commitRanks', () => {
    it('orders by when the commit was made, not by where it appears', () => {
        // The newest commit is at the top of the file here, which is the usual
        // case for an import block and would rank it first by position.
        const ranks = commitRanks([
            block('c', '2024-01-01', 1),
            block('a', '2020-01-01', 2),
            block('b', '2022-01-01', 3),
        ]);

        expect(ranks.get('a'.repeat(40))).toBe(0);
        expect(ranks.get('b'.repeat(40))).toBe(1);
        expect(ranks.get('c'.repeat(40))).toBe(2);
    });

    it('gives one commit one rank however many blocks it owns', () => {
        // A commit that touched six parts of a file must be one colour in all
        // six, or the file looks like it had six authors.
        const ranks = commitRanks([
            block('a', '2020-01-01', 1),
            block('b', '2021-01-01', 2),
            block('a', '2020-01-01', 3),
            block('a', '2020-01-01', 9),
        ]);

        expect(ranks.size).toBe(2);
    });

    it('leaves uncommitted work off the timeline', () => {
        const ranks = commitRanks([
            block('a', '2020-01-01', 1),
            block('0', '2024-01-01', 2, true),
        ]);

        expect(ranks.size).toBe(1);
        expect(ranks.has('0'.repeat(40))).toBe(false);
    });
});

describe('rampColour', () => {
    it('separates adjacent ranks, so two commits never look alike', () => {
        // The property the whole thing exists for. Colouring by elapsed time
        // instead would collapse a week of steady work into one shade.
        const colours = Array.from({ length: 6 }, (_, rank) =>
            rampColour(rank, 6)
        );

        expect(new Set(colours).size).toBe(6);
    });

    it('runs cool to warm, so the order is readable without a legend', () => {
        const oldest = rampColour(0, 5);
        const newest = rampColour(4, 5);

        // Blue at the old end, red at the new one.
        expect(oldest).toContain('rgba(59, 130, 246');
        expect(newest).toContain('rgba(239, 68, 68');
    });

    it('grows more present towards the newest', () => {
        expect(alphaOf(rampColour(0, 5))).toBeLessThan(
            alphaOf(rampColour(4, 5))
        );
    });

    it('stays a tint rather than a fill, at every rank', () => {
        // Anything heavier buries the text under it on a light theme.
        for (let rank = 0; rank < 12; rank++) {
            expect(alphaOf(rampColour(rank, 12))).toBeLessThan(0.3);
        }
    });

    it('treats a file with one commit as new, not ancient', () => {
        expect(rampColour(0, 1)).toContain('rgba(239, 68, 68');
    });
});
