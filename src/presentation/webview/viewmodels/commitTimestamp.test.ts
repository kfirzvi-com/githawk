import { describe, expect, test } from 'vitest';
import { commitTimestamp, commitTimestampTooltip } from './commitTimestamp';

/**
 * Every assertion that names a string pins the locale and the zone. Left to the
 * host, these tests would pass in Tel Aviv and fail on a runner in UTC, which
 * is a property of the test rather than of the code.
 */
const UTC = { locales: 'en-US', timeZone: 'UTC' } as const;

// One of the fixture commits, so the strings here are the ones on screen.
const commit = new Date('2023-09-03T18:45:00Z');

describe('commitTimestamp', () => {
    test('carries the time as well as the date', () => {
        expect(commitTimestamp(commit, UTC)).toBe('9/3/23, 6:45 PM');
    });

    test('separates two commits made on the same day', () => {
        // The reason the column exists: date-only, these were one row apart and
        // indistinguishable.
        const morning = new Date('2023-09-03T09:15:00Z');
        expect(commitTimestamp(morning, UTC)).not.toBe(
            commitTimestamp(commit, UTC)
        );
    });

    test('follows the locale rather than imposing a format', () => {
        // Same instant, British order, 24-hour clock.
        expect(commitTimestamp(commit, { ...UTC, locales: 'en-GB' })).toBe(
            '03/09/2023, 18:45'
        );
    });

    test('renders in the reader’s zone, not the commit’s', () => {
        // Committed at 18:45Z, which is the next day in Tokyo. A graph that
        // said otherwise would disagree with the clock on the wall.
        expect(
            commitTimestamp(commit, { locales: 'en-US', timeZone: 'Asia/Tokyo' })
        ).toBe('9/4/23, 3:45 AM');
    });
});

describe('commitTimestampTooltip', () => {
    test('spells out what the column abbreviates, down to the second', () => {
        expect(commitTimestampTooltip(commit, UTC)).toBe(
            'Sunday, September 3, 2023 at 6:45:00 PM'
        );
    });
});
