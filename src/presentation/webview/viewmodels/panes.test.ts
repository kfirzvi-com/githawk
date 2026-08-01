import { describe, expect, it } from 'vitest';
import {
    defaultPaneVisibility,
    paneToggleLabel,
    readPaneVisibility,
    withPane,
} from './panes';

describe('readPaneVisibility', () => {
    it('shows both panes when nothing has been stored', () => {
        expect(readPaneVisibility(undefined)).toEqual(defaultPaneVisibility);
        expect(readPaneVisibility(null)).toEqual(defaultPaneVisibility);
    });

    it('restores what was stored', () => {
        expect(readPaneVisibility({ branches: false, details: true })).toEqual({
            branches: false,
            details: true,
        });
    });

    /**
     * Persisted state is written by whichever version of the webview ran last,
     * so it is untrusted input. Erring towards visible: a pane that is missing
     * for no apparent reason is much harder to work out than one that is there.
     */
    it('shows a pane whose stored value makes no sense', () => {
        expect(readPaneVisibility({ branches: 'no', details: 0 })).toEqual({
            branches: true,
            details: true,
        });
        expect(readPaneVisibility('collapsed')).toEqual(defaultPaneVisibility);
        expect(readPaneVisibility({})).toEqual(defaultPaneVisibility);
    });
});

describe('withPane', () => {
    it('changes one pane and leaves the other alone', () => {
        const hidden = withPane(defaultPaneVisibility, 'branches', false);

        expect(hidden).toEqual({ branches: false, details: true });
        // The original is untouched, so it can be compared against.
        expect(defaultPaneVisibility.branches).toBe(true);
    });

    it('can hide both', () => {
        const none = withPane(
            withPane(defaultPaneVisibility, 'branches', false),
            'details',
            false
        );

        expect(none).toEqual({ branches: false, details: false });
    });
});

describe('paneToggleLabel', () => {
    it('says what the click will do, not what the state is', () => {
        expect(paneToggleLabel('branches', true)).toBe('Hide the branch list');
        expect(paneToggleLabel('branches', false)).toBe('Show the branch list');
        expect(paneToggleLabel('details', true)).toBe('Hide commit details');
        expect(paneToggleLabel('details', false)).toBe('Show commit details');
    });
});
