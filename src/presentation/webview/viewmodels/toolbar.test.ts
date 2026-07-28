import { describe, expect, test } from 'vitest';
import { repositoryIndicator } from './toolbar';

const api = { root: '/w/apps/api', name: 'api', description: 'apps/api' };
const web = { root: '/w/web', name: 'web', description: 'web' };

describe('repositoryIndicator', () => {
    test('shows nothing before the host has reported any repository', () => {
        // The dev harness never does, and the toolbar must look unchanged there.
        expect(repositoryIndicator([], undefined)).toBeNull();
    });

    test('names the active repository', () => {
        expect(repositoryIndicator([api, web], '/w/web')?.name).toBe('web');
    });

    test('reports how many there are to choose from', () => {
        // A single repository still gets a selector: the picker is also where a
        // rescan lives.
        expect(repositoryIndicator([api], '/w/apps/api')?.count).toBe(1);
        expect(repositoryIndicator([api, web], '/w/web')?.count).toBe(2);
    });

    test('falls back to the first rather than disappearing', () => {
        // An unknown active root is a bug; hiding the control would hide it too.
        expect(repositoryIndicator([api, web], '/w/gone')?.name).toBe('api');
    });

    test('puts the location in the tooltip, not the label', () => {
        const indicator = repositoryIndicator([api, web], '/w/apps/api');

        expect(indicator?.name).toBe('api');
        expect(indicator?.detail).toBe('apps/api — /w/apps/api');
    });
});
