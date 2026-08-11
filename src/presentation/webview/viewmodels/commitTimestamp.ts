/**
 * The graph's right-hand timestamp column.
 *
 * A date alone answers "roughly when", which is enough until someone is reading
 * a day's worth of commits and needs their order within it — reviewing what
 * happened this morning, or working out which of two commits an hour apart
 * introduced something. The graph's own order already says which came first;
 * the time is what says how far apart.
 *
 * Short forms for both parts, and one string rather than a second column: the
 * row also carries a subject and an author, and the full form is what the
 * details panel is for.
 *
 * Locale-driven throughout. The default asks for the host's own format rather
 * than imposing an American one, so widths vary — `8/11/26, 10:23 AM` against
 * `11.08.26, 10:23` — which is why the column is sized generously and its
 * digits are tabular.
 */

/**
 * Only ever passed by tests and by anything that needs a reproducible render.
 * Left undefined, both parts follow the host, which is what the webview wants:
 * a date column that disagrees with the rest of the machine is a bug.
 */
export interface TimestampFormat {
    locales?: Intl.LocalesArgument;
    timeZone?: string;
}

export function commitTimestamp(
    date: Date,
    { locales, timeZone }: TimestampFormat = {}
): string {
    return date.toLocaleString(locales, {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone,
    });
}

/**
 * The tooltip behind it: the weekday, the unabbreviated date, and seconds.
 *
 * The column is deliberately terse, and a two-digit year is one of the things
 * it gives up. Hovering is how to get it back without selecting the commit.
 */
export function commitTimestampTooltip(
    date: Date,
    { locales, timeZone }: TimestampFormat = {}
): string {
    return date.toLocaleString(locales, {
        dateStyle: 'full',
        timeStyle: 'medium',
        timeZone,
    });
}
