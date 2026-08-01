import {
    WorkingTreeStatus,
    cleanWorkingTree,
} from '../../domain/models/WorkingTreeStatus';

/**
 * Parses `git status --porcelain -z`.
 *
 * Each record is `XY <path>`, NUL-terminated. X is the index against HEAD, Y is
 * the working tree against the index — so one file can be both staged and
 * modified, and is counted in both.
 *
 * NUL-separated rather than newline-separated because a path may contain a
 * newline. Without -z git quotes such a path instead, which is a second format
 * to parse and a second thing to get wrong.
 *
 * A rename record carries two paths (`R  new\0old\0`), so the record after a
 * rename or a copy is a path rather than a status and must be skipped — reading
 * it as a status is how a rename becomes two phantom changes.
 */
export class GitStatusParser {
    static parse(output: string): WorkingTreeStatus {
        const status = { ...cleanWorkingTree };
        const records = output.split('\0');

        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            // A status record is two code characters, a space, then the path.
            if (record.length < 3) {
                continue;
            }

            const x = record[0];
            const y = record[1];

            if (x === '?' && y === '?') {
                status.untracked += 1;
                continue;
            }
            // Only present with --ignored, but harmless to be explicit.
            if (x === '!' && y === '!') {
                continue;
            }

            if (isConflict(x, y)) {
                status.conflicted += 1;
            } else {
                if (x !== ' ') {
                    status.staged += 1;
                }
                if (y !== ' ') {
                    status.unstaged += 1;
                }
            }

            if (x === 'R' || x === 'C') {
                // The next record is this file's previous path, not a status.
                i += 1;
            }
        }

        return status;
    }
}

/**
 * git's own rule: a conflict is any record where both sides are U, or where
 * both sides are the same letter among A and D. `AU`, `UD`, `DD`, `AA`, `UU`
 * and friends — the full set from git-status(1).
 */
function isConflict(x: string, y: string): boolean {
    return (
        x === 'U' ||
        y === 'U' ||
        (x === 'A' && y === 'A') ||
        (x === 'D' && y === 'D')
    );
}
