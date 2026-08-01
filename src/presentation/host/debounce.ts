/**
 * Collapses a burst of events into one call.
 *
 * Git operations are not single writes. A rebase rewrites HEAD, the index, and
 * a ref for every commit it replays; a fetch touches every remote ref it
 * updated. Reloading the graph once per write would mean dozens of `git log`
 * runs during one operation, each one rendering a repository mid-flight.
 *
 * Trailing rather than leading: the interesting state is the one the operation
 * ends in, not the one it starts from.
 */
export class Debouncer {
    private timer?: ReturnType<typeof setTimeout>;
    /** When the current burst started, so `maxWaitMs` can be honoured. */
    private firstCallAt?: number;

    constructor(
        private readonly run: () => void,
        private readonly waitMs: number,
        /**
         * An upper bound on how long a burst can postpone the call. Without it
         * an operation that writes steadily — a rebase over hundreds of commits
         * — would hold the graph on its pre-rebase state for the whole run.
         */
        private readonly maxWaitMs: number,
        /** Injected so tests can drive time without waiting for it. */
        private readonly now: () => number = () => Date.now()
    ) {}

    schedule(): void {
        const startedAt = (this.firstCallAt ??= this.now());
        const elapsed = this.now() - startedAt;

        clearTimeout(this.timer);
        this.timer = setTimeout(
            () => this.fire(),
            Math.max(0, Math.min(this.waitMs, this.maxWaitMs - elapsed))
        );
    }

    /** Runs a pending call immediately, if there is one. */
    flush(): void {
        if (this.timer !== undefined) {
            this.fire();
        }
    }

    cancel(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.firstCallAt = undefined;
    }

    private fire(): void {
        this.cancel();
        this.run();
    }
}
