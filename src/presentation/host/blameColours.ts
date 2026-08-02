import type { BlameBlock } from '../../domain/models/Blame';

/**
 * A colour per commit, ordered by when the commit was made.
 *
 * Two jobs at once, and they pull in different directions. The colour has to
 * separate one commit from the next — two adjacent blocks that look the same
 * are one block to a reader — and it has to carry an order, so that scrolling a
 * file shows the sequence it was built in rather than just that it was built by
 * several people.
 *
 * Ranking the distinct commits and spreading the ramp across the ranks serves
 * both. Colouring by elapsed time instead would be truer to the clock and
 * useless in practice: a week of steady work would come out as one shade, and
 * the file would look like it appeared all at once.
 */

/**
 * Oldest commit is rank 0. Distinct commits only, so a commit touching six
 * separate parts of a file is one colour in all six.
 */
export function commitRanks(blocks: readonly BlameBlock[]): Map<string, number> {
    const byHash = new Map<string, Date>();
    for (const block of blocks) {
        if (!block.commit.isUncommitted) {
            byHash.set(block.commit.hash, block.commit.authoredAt);
        }
    }

    const ordered = [...byHash.entries()].sort(
        ([, a], [, b]) => a.getTime() - b.getTime()
    );

    return new Map(ordered.map(([hash], rank) => [hash, rank]));
}

/**
 * The ramp: cool and quiet for the oldest lines, warm and present for the
 * newest. Anchors are interpolated in RGB, which is crude but predictable, and
 * these four are far enough apart that the seams do not show.
 *
 * Emitted at low alpha so it tints whatever the editor's background is rather
 * than replacing it — the same reason the panel's row states come from VS
 * Code's list tokens. That is also what keeps it legible on a light theme,
 * where an opaque version of any of these would bury the text.
 */
const RAMP: [number, number, number][] = [
    [59, 130, 246], // oldest — blue
    [16, 185, 129], // green
    [245, 158, 11], // amber
    [239, 68, 68], // newest — red
];

const ALPHA_OLDEST = 0.1;
const ALPHA_NEWEST = 0.26;

export function rampColour(rank: number, total: number): string {
    // A file with one commit gets the newest end rather than the oldest: it is
    // new, and showing it as ancient would be the wrong answer to the question.
    const position = total <= 1 ? 1 : rank / (total - 1);

    const [red, green, blue] = interpolate(position);
    const alpha = ALPHA_OLDEST + (ALPHA_NEWEST - ALPHA_OLDEST) * position;

    return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
}

/** Uncommitted work is not on the timeline; it is what happens after it. */
export const UNCOMMITTED_COLOUR = 'rgba(148, 163, 184, 0.28)';

function interpolate(position: number): [number, number, number] {
    const scaled = Math.min(
        RAMP.length - 1 - 1e-9,
        Math.max(0, position) * (RAMP.length - 1)
    );
    const index = Math.floor(scaled);
    const fraction = scaled - index;

    const from = RAMP[index];
    const to = RAMP[index + 1];

    return [0, 1, 2].map((channel) =>
        Math.round(from[channel] + (to[channel] - from[channel]) * fraction)
    ) as [number, number, number];
}
