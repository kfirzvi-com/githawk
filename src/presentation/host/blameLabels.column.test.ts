import { describe, expect, it } from 'vitest';
import { columnLabel, shortDate } from './blameLabels';
import type { BlameBlock } from '../../domain/models/Blame';

const block = (author: string, at: string): BlameBlock => ({
    startLine: 1,
    endLine: 1,
    commit: {
        hash: 'a'.repeat(40),
        shortHash: 'aaaaaaaa',
        author,
        authorEmail: 'a@example.com',
        authoredAt: new Date(at),
        summary: 'x',
        isUncommitted: false,
    },
});

describe('columnLabel', () => {
    it('is always exactly the column width', () => {
        for (const author of ['Bo', 'Wenningdorf-Smythe', 'Kfir Zvi']) {
            expect(columnLabel(block(author, '2020-08-11'), 16)).toHaveLength(16);
        }
    });

    it('puts the date first and truncates the name, not the date', () => {
        // The date is what the eye scans down the column; a clipped date would
        // make two different years look the same.
        const label = columnLabel(block('Wenningdorf-Smythe', '2020-08-11'), 16);
        expect(label.startsWith('8/11/20 ')).toBe(true);
    });

    it('pads with a character that survives contentText', () => {
        // An ordinary space collapses in a decoration, which would let the
        // column breathe in and out line by line.
        const label = columnLabel(block('Bo', '2020-08-11'), 16);
        expect(label).toContain(' ');
        expect(label).not.toContain('  ');
    });
});

describe('shortDate', () => {
    it('is a short American date, as IntelliJ shows it', () => {
        expect(shortDate(new Date(2020, 7, 11))).toBe('8/11/20');
    });
});
