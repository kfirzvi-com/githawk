import { describe, expect, it } from 'vitest';
import { defaultSections, readSections, withSection } from './sections';

describe('readSections', () => {
    it('opens everything when nothing has been stored', () => {
        expect(readSections(undefined)).toEqual(defaultSections);
        expect(readSections(null)).toEqual(defaultSections);
        expect(readSections('open')).toEqual(defaultSections);
    });

    it('restores what was stored', () => {
        expect(readSections({ local: true, remote: false })).toEqual({
            local: true,
            remote: false,
            worktrees: true,
            stashes: true,
        });
    });

    it('opens a section whose stored value makes no sense', () => {
        // Erring towards visible: a section missing for no apparent reason is
        // harder to work out than one that is simply there.
        expect(readSections({ local: 'no', stashes: 0 })).toEqual(
            defaultSections
        );
    });
});

describe('withSection', () => {
    it('changes one section and leaves the others alone', () => {
        expect(withSection(defaultSections, 'stashes', false)).toEqual({
            local: true,
            remote: true,
            worktrees: true,
            stashes: false,
        });
        expect(defaultSections.stashes).toBe(true);
    });
});
