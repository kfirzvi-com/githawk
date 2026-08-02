import { Stash } from '../../domain/models/Stash';
import { RECORD_SEPARATOR, UNIT_SEPARATOR } from './gitCommands';

/**
 * Parses `git stash list` in the format stashListArgs asks for.
 *
 * The interesting field is git's reflog subject, which comes in two shapes:
 *
 *     On main: something I typed
 *     WIP on main: 1234abc the subject of the commit I was on
 *
 * The second is git's own wording when no message was given, and it describes
 * the commit the work sat on rather than the work — so it is kept, because
 * hiding it would leave an entry with no label at all, but flagged so the UI
 * can say that nothing was written down.
 *
 * A branch name cannot contain a colon, so splitting on the first `: ` after
 * the prefix is unambiguous.
 */
export class GitStashParser {
    static parse(output: string): Stash[] {
        return output
            .split(RECORD_SEPARATOR)
            .map((record) => record.trim())
            .filter((record) => record.length > 0)
            .map((record, index) => toStash(record, index))
            .filter((stash): stash is Stash => stash !== undefined);
    }
}

function toStash(record: string, index: number): Stash | undefined {
    const [ref, hash, subject, date, author, parents] =
        record.split(UNIT_SEPARATOR);
    if (!ref || !hash) {
        return undefined;
    }

    const { branch, message, isAutoNamed } = describe(subject ?? '');

    return {
        ref,
        index,
        hash,
        shortHash: hash.slice(0, 8),
        branch,
        message,
        isAutoNamed,
        createdAt: date ? new Date(date) : new Date(0),
        author: author ?? '',
        // First only. See Stash.baseHash for why the other two are dropped.
        baseHash: (parents ?? '').trim().split(/\s+/)[0] ?? '',
    };
}

function describe(subject: string): {
    branch: string;
    message: string;
    isAutoNamed: boolean;
} {
    const match = /^(WIP on|On) ([^:]+): (.*)$/.exec(subject);
    if (!match) {
        // Not a shape git is documented to produce, but an entry with an odd
        // subject should still be listed and actionable.
        return { branch: '', message: subject, isAutoNamed: false };
    }

    const [, prefix, branch, rest] = match;
    return { branch, message: rest, isAutoNamed: prefix === 'WIP on' };
}
