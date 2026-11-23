import { describe, expect, it } from 'vitest';
import { NEW_IDS, OLD_ID, offersMove } from './publisherMove';

describe('offersMove', () => {
    it('offers the switch under the old identifier, in any case', () => {
        expect(offersMove(OLD_ID)).toBe(true);
        expect(offersMove('KfirZvi-com.GitHawk')).toBe(true);
    });

    it('stays silent under both new identifiers', () => {
        for (const id of NEW_IDS) {
            expect(offersMove(id)).toBe(false);
        }
    });

    it('tries the Marketplace identifier before the Open VSX one', () => {
        expect(NEW_IDS).toEqual(['praktical.githawk-graph', 'praktical.githawk']);
    });
});
