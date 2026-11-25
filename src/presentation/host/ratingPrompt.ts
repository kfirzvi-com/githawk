import { NEW_IDS } from './publisherMove';

/**
 * When to ask for a rating, and where to send the person who says yes.
 *
 * Asked only after GitHawk has been used on several different days, at most
 * twice, and never again once the person rates or says no. The counts stay in
 * the editor's own storage: nothing leaves the machine.
 *
 * Kept free of `vscode` so the rules, and the steps in `RatingFlow`, can be
 * unit-tested; `RatingNotice` connects them to the editor. *
 * HermiTile has a copy in `src/presentation/host/ratingPrompt.ts`; change both
 * together.
 */
export interface RatingState {
    /** Distinct days the graph was opened. */
    readonly useDays: number;
    /** The last day counted, as `YYYY-MM-DD`, so a day counts once. */
    readonly lastUseDay?: string;
    /** How many times the question has been shown. */
    readonly asks: number;
    /** Rated, or asked not to be asked again. */
    readonly done: boolean;
}

export const INITIAL_RATING_STATE: RatingState = { useDays: 0, asks: 0, done: false };

/** Use days before the first ask, and before the second (after "Later"). */
export const ASK_AT_USE_DAYS = [7, 30] as const;

const [MARKETPLACE_ID, OPEN_VSX_ID] = NEW_IDS;

/**
 * Each registry has its own identifier (see `publisherMove`), so the id says
 * where this copy came from. Keyed by `NEW_IDS`, so the two cannot drift.
 */
export const REVIEW_PAGES: Readonly<Record<(typeof NEW_IDS)[number], string>> = {
    [MARKETPLACE_ID]: `https://marketplace.visualstudio.com/items?itemName=${MARKETPLACE_ID}&ssr=false#review-details`,
    [OPEN_VSX_ID]: `https://open-vsx.org/extension/${OPEN_VSX_ID.replace('.', '/')}/reviews`,
};

/** Where the command sends a copy that came from neither store: the old identifier, or a dev build. */
export const DEFAULT_REVIEW_PAGE = REVIEW_PAGES[MARKETPLACE_ID];

/** The review page for the store this copy came from; undefined under any other identifier. */
export function reviewPage(extensionId: string): string | undefined {
    const id = extensionId.toLowerCase();
    return (NEW_IDS as readonly string[]).includes(id)
        ? REVIEW_PAGES[id as (typeof NEW_IDS)[number]]
        : undefined;
}

/** Counts `day` as a use day, once. Returns the same object when nothing changed. */
export function recordUse(state: RatingState, day: string): RatingState {
    if (state.lastUseDay === day) {
        return state;
    }
    return { ...state, useDays: state.useDays + 1, lastUseDay: day };
}

export function shouldAsk(state: RatingState): boolean {
    if (state.done || state.asks >= ASK_AT_USE_DAYS.length) {
        return false;
    }
    return state.useDays >= ASK_AT_USE_DAYS[state.asks];
}

export function asked(state: RatingState): RatingState {
    return { ...state, asks: state.asks + 1 };
}

export function finished(state: RatingState): RatingState {
    return { ...state, done: true };
}

/** The local calendar day, so "a day" means the person's day, not UTC's. */
export function dayOf(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The person's answer; closing the popup counts as "later". */
export type RatingAnswer = 'rate' | 'later' | 'never';

/** What the flow needs from the editor. */
export interface RatingPorts {
    read(): RatingState;
    write(state: RatingState): Promise<void>;
    ask(): Promise<RatingAnswer>;
    open(url: string): Promise<void>;
    today(): string;
}

/** The steps: count the day, maybe ask, act on the answer. */
export class RatingFlow {
    private showing = false;

    constructor(
        private readonly extensionId: string,
        private readonly ports: RatingPorts
    ) {}

    /** Called each time the graph is shown. */
    async onGraphShown(): Promise<void> {
        // Silent under the old identifier, which has its own notice; and while
        // the question is already on screen.
        if (reviewPage(this.extensionId) === undefined || this.showing) {
            return;
        }
        const before = this.ports.read();
        const current = recordUse(before, this.ports.today());
        if (!shouldAsk(current)) {
            if (current !== before) {
                await this.ports.write(current);
            }
            return;
        }

        this.showing = true;
        try {
            // Counted before showing, on purpose: an ask the window closed on
            // still counts, so "at most twice" holds whatever happens next.
            await this.ports.write(asked(current));
            const answer = await this.ports.ask();
            if (answer === 'rate') {
                await this.rate();
            } else if (answer === 'never') {
                // Read again rather than reuse `current`: the ask above was written since.
                await this.ports.write(finished(this.ports.read()));
            }
        } finally {
            this.showing = false;
        }
    }

    /** The command, and the popup's yes. Either way, the question is not asked again. */
    async rate(): Promise<void> {
        // Open first: if the browser fails, the person has not rated, so keep asking.
        await this.ports.open(reviewPage(this.extensionId) ?? DEFAULT_REVIEW_PAGE);
        await this.ports.write(finished(this.ports.read()));
    }
}
