import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NEW_IDS } from './publisherMove';
import {
    ASK_AT_USE_DAYS,
    DEFAULT_REVIEW_PAGE,
    INITIAL_RATING_STATE,
    REVIEW_PAGES,
    RatingFlow,
    asked,
    dayOf,
    finished,
    recordUse,
    reviewPage,
    shouldAsk,
    type RatingAnswer,
    type RatingState,
} from './ratingPrompt';

function usedOn(days: number, state: RatingState = INITIAL_RATING_STATE): RatingState {
    let next = state;
    for (let i = 0; i < days; i++) {
        next = recordUse(next, `use-${state.useDays + i}`);
    }
    return next;
}

describe('recordUse', () => {
    it('counts a day once, however often the graph opens that day', () => {
        let state = recordUse(INITIAL_RATING_STATE, '2026-11-24');
        state = recordUse(state, '2026-11-24');
        expect(state.useDays).toBe(1);
        expect(recordUse(state, '2026-11-25').useDays).toBe(2);
    });
});

describe('shouldAsk', () => {
    it('waits for the first threshold of use days', () => {
        expect(shouldAsk(usedOn(ASK_AT_USE_DAYS[0] - 1))).toBe(false);
        expect(shouldAsk(usedOn(ASK_AT_USE_DAYS[0]))).toBe(true);
    });

    it('after "Later", waits for the second threshold', () => {
        const later = asked(usedOn(ASK_AT_USE_DAYS[0]));
        expect(shouldAsk(later)).toBe(false);
        expect(shouldAsk(usedOn(ASK_AT_USE_DAYS[1] - ASK_AT_USE_DAYS[0], later))).toBe(true);
    });

    it('asks at most twice', () => {
        const twice = asked(asked(usedOn(ASK_AT_USE_DAYS[1])));
        expect(shouldAsk(usedOn(100, twice))).toBe(false);
    });

    it('never asks again once rated or refused', () => {
        expect(shouldAsk(finished(usedOn(ASK_AT_USE_DAYS[1])))).toBe(false);
    });
});

describe('reviewPage', () => {
    it("sends each store's identifier to that store's reviews", () => {
        expect(reviewPage('praktical.githawk-graph')).toContain('marketplace.visualstudio.com');
        expect(reviewPage('Praktical.GitHawk')).toContain('open-vsx.org');
    });

    it('has none for the old identifier', () => {
        expect(reviewPage('kfirzvi-com.githawk')).toBeUndefined();
    });

    it('covers exactly the identifiers GitHawk is published under', () => {
        expect(Object.keys(REVIEW_PAGES)).toEqual([...NEW_IDS]);
    });

    it('matches the links in the README', () => {
        const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
        for (const page of Object.values(REVIEW_PAGES)) {
            expect(readme).toContain(page);
        }
    });
});

describe('dayOf', () => {
    it('is the local calendar day', () => {
        expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });
});

/** The editor, faked: an in-memory store, a scripted answer, and a record of what happened. */
function editor(answer: RatingAnswer, start: RatingState = INITIAL_RATING_STATE) {
    const fake = {
        state: start,
        writes: 0,
        asks: 0,
        opened: [] as string[],
        day: 0,
    };
    const ports = {
        read: () => fake.state,
        write: async (next: RatingState) => {
            fake.state = next;
            fake.writes++;
        },
        ask: async () => {
            fake.asks++;
            return answer;
        },
        open: async (url: string) => {
            fake.opened.push(url);
        },
        today: () => `day-${fake.day}`,
    };
    return { fake, ports };
}

async function showOnDays(flow: RatingFlow, fake: { day: number }, days: number) {
    for (let i = 0; i < days; i++) {
        fake.day++;
        await flow.onGraphShown();
    }
}

describe('RatingFlow', () => {
    it('asks on the seventh use day, not before', async () => {
        const { fake, ports } = editor('later');
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        await showOnDays(flow, fake, ASK_AT_USE_DAYS[0] - 1);
        expect(fake.asks).toBe(0);
        await showOnDays(flow, fake, 1);
        expect(fake.asks).toBe(1);
    });

    it('"Rate" opens the store this copy came from, and stops asking', async () => {
        const { fake, ports } = editor('rate', usedOn(ASK_AT_USE_DAYS[0] - 1));
        const flow = new RatingFlow('praktical.githawk', ports);
        await showOnDays(flow, fake, 1);
        expect(fake.opened).toEqual([REVIEW_PAGES['praktical.githawk']]);
        await showOnDays(flow, fake, 100);
        expect(fake.asks).toBe(1);
    });

    it('"Don\'t Ask Again" stops asking, and keeps the ask counted', async () => {
        const { fake, ports } = editor('never', usedOn(ASK_AT_USE_DAYS[0] - 1));
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        await showOnDays(flow, fake, 100);
        expect(fake.asks).toBe(1);
        expect(fake.state).toMatchObject({ asks: 1, done: true });
        expect(fake.opened).toEqual([]);
    });

    it('"Later" asks once more, then never', async () => {
        const { fake, ports } = editor('later');
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        await showOnDays(flow, fake, 200);
        expect(fake.asks).toBe(2);
    });

    it('does not ask twice while the question is still on screen', async () => {
        const { fake, ports } = editor('later', usedOn(ASK_AT_USE_DAYS[0] - 1));
        // A store that takes a moment to save, so the second show reads the
        // state from before the first ask was counted.
        const save = ports.write;
        ports.write = async (next) => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            await save(next);
        };
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        fake.day++;
        const first = flow.onGraphShown();
        fake.day++;
        const second = flow.onGraphShown();
        await Promise.all([first, second]);
        expect(fake.asks).toBe(1);
    });

    it('writes nothing when the graph is shown again the same day', async () => {
        const { fake, ports } = editor('later');
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        await flow.onGraphShown();
        await flow.onGraphShown();
        await flow.onGraphShown();
        expect(fake.writes).toBe(1);
    });

    it('keeps asking when the browser fails to open', async () => {
        const { fake, ports } = editor('rate', usedOn(ASK_AT_USE_DAYS[0] - 1));
        ports.open = async () => {
            throw new Error('no browser');
        };
        const flow = new RatingFlow('praktical.githawk-graph', ports);
        fake.day++;
        await expect(flow.onGraphShown()).rejects.toThrow('no browser');
        expect(fake.state.done).toBe(false);
    });

    it('stays silent under the old identifier, but the command still opens a page', async () => {
        const { fake, ports } = editor('rate', usedOn(100));
        const flow = new RatingFlow('kfirzvi-com.githawk', ports);
        await showOnDays(flow, fake, 10);
        expect(fake.asks).toBe(0);
        await flow.rate();
        expect(fake.opened).toEqual([DEFAULT_REVIEW_PAGE]);
    });
});
