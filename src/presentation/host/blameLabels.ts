import type { BlameBlock } from '../../domain/models/Blame';

/**
 * The words a blame annotation shows. Pure, so what it says can be asserted
 * without an editor — and so the three rendering styles cannot drift into
 * describing the same commit differently.
 */

/** Compact enough to sit in a gutter: `Kfir · 3mo`. */
export function gutterLabel(block: BlameBlock, now: Date): string {
    if (block.commit.isUncommitted) {
        return 'uncommitted';
    }
    return `${firstName(block.commit.author)} · ${shortAge(block.commit.authoredAt, now)}`;
}

/** For the end of a line, where there is room for the subject too. */
export function inlineLabel(block: BlameBlock, now: Date): string {
    if (block.commit.isUncommitted) {
        return 'Uncommitted changes';
    }
    const { author, authoredAt, summary } = block.commit;
    return `${author}, ${shortAge(authoredAt, now)} · ${truncate(summary, 50)}`;
}

/** Only the first name fits a gutter, and it is what distinguishes a team. */
function firstName(author: string): string {
    return author.split(/\s+/)[0] ?? author;
}

/**
 * Coarse on purpose. The question a blame answers is "is this old or new",
 * and an exact date is available on hover for when it is not.
 */
export function shortAge(date: Date, now: Date): string {
    const seconds = Math.max(0, (now.getTime() - date.getTime()) / 1000);
    const days = seconds / 86_400;

    if (days < 1) {
        return 'today';
    }
    if (days < 2) {
        return 'yesterday';
    }
    if (days < 31) {
        return `${Math.floor(days)}d`;
    }
    if (days < 365) {
        return `${Math.floor(days / 30)}mo`;
    }
    return `${Math.floor(days / 365)}y`;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The IntelliJ-style column: a date and a name, on every line, at a fixed
 * width so the code beside it stays aligned.
 *
 * `8/11/20 Wenningd` — the date carries the precision and the name carries the
 * identity, and both are truncated rather than wrapped because the column's
 * whole value is that it is the same width on every line.
 */
export function columnLabel(block: BlameBlock, width: number): string {
    if (block.commit.isUncommitted) {
        return pad('uncommitted', width);
    }

    const date = shortDate(block.commit.authoredAt);
    const name = firstName(block.commit.author);
    const room = width - date.length - 1;

    return pad(`${date} ${name.slice(0, Math.max(0, room))}`, width);
}

/** `8/11/20`. Short enough for a column, exact enough to sort by eye. */
export function shortDate(date: Date): string {
    const year = `${date.getFullYear()}`.slice(2);
    return `${date.getMonth() + 1}/${date.getDate()}/${year}`;
}

/**
 * Padded with a non-breaking space: a decoration's contentText collapses runs
 * of ordinary spaces, so a plain space would not hold the column open.
 */
function pad(text: string, width: number): string {
    return text.length >= width
        ? text.slice(0, width)
        : text + '\u00a0'.repeat(width - text.length);
}
