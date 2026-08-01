import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from './debounce';

describe('Debouncer', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const debouncer = (
        run: () => void,
        waitMs = 100,
        maxWaitMs = 1000
    ): Debouncer =>
        new Debouncer(run, waitMs, maxWaitMs, () => Date.now());

    it('runs once after the burst stops', () => {
        const run = vi.fn();
        const subject = debouncer(run);

        subject.schedule();
        subject.schedule();
        subject.schedule();
        expect(run).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('waits for the burst rather than firing at the first event', () => {
        const run = vi.fn();
        const subject = debouncer(run);

        subject.schedule();
        vi.advanceTimersByTime(80);
        subject.schedule();
        vi.advanceTimersByTime(80);

        // 160ms in, but never 100ms quiet — a rebase writing steadily.
        expect(run).not.toHaveBeenCalled();

        vi.advanceTimersByTime(100);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('gives up postponing once maxWait is reached', () => {
        const run = vi.fn();
        const subject = debouncer(run, 100, 250);

        // A write every 80ms would postpone forever on wait alone.
        for (let elapsed = 0; elapsed < 400; elapsed += 80) {
            subject.schedule();
            vi.advanceTimersByTime(80);
        }

        expect(run).toHaveBeenCalled();
    });

    it('starts a fresh window after it has fired', () => {
        const run = vi.fn();
        const subject = debouncer(run);

        subject.schedule();
        vi.advanceTimersByTime(100);
        subject.schedule();
        vi.advanceTimersByTime(100);

        expect(run).toHaveBeenCalledTimes(2);
    });

    it('cancels a pending call', () => {
        const run = vi.fn();
        const subject = debouncer(run);

        subject.schedule();
        subject.cancel();
        vi.advanceTimersByTime(1000);

        expect(run).not.toHaveBeenCalled();
    });

    it('flushes a pending call, and does nothing when there is none', () => {
        const run = vi.fn();
        const subject = debouncer(run);

        subject.flush();
        expect(run).not.toHaveBeenCalled();

        subject.schedule();
        subject.flush();
        expect(run).toHaveBeenCalledTimes(1);

        // The flush consumed it; the timer must not fire a second time.
        vi.advanceTimersByTime(1000);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
